-- =====================================================================
-- BHD FILMS — MIGRATION 015: admin can record a payment on a customer's
-- behalf when THEIR OWN receipt upload fails
-- =====================================================================
-- Very occasionally a customer pays via the QR code but their phone
-- won't let them upload the screenshot (a known Android browser bug in
-- how "Choose file" was configured — fixed separately in this same
-- update, see PaymentQR.jsx etc.). Until now the only fallback was the
-- admin manually editing the customer's wallet balance directly, which
-- skips the whole approval trail (no receipt attached, no separate
-- "someone reviewed this" step, nothing showing up in Fund Requests).
--
-- This adds a proper fallback instead: the admin uploads the SAME
-- screenshot the customer sent them (e.g. over WhatsApp) themselves,
-- which creates a normal PENDING fund request exactly like the customer
-- had submitted it - it shows up in Fund Requests, every admin gets the
-- usual notification, and it still has to be reviewed/approved through
-- the normal admin_review_fund_request() flow before any money moves.
-- Nothing about the trusted approval path changes; this only adds a
-- second way to GET a request into that path when the customer's own
-- upload is the thing that's broken.
--
-- Safe to run more than once.
-- =====================================================================

-- Marks which fund requests were entered by an admin instead of
-- submitted by the customer themselves, and keeps the admin's note
-- (e.g. "customer's upload kept failing, they WhatsApp'd me this
-- screenshot instead") visible even after the request is reviewed.
alter table public.fund_requests
  add column if not exists submitted_by_admin_id uuid references auth.users(id);

alter table public.fund_requests
  add column if not exists admin_submission_note text;

create or replace function public.admin_create_fund_request_for_customer(
  p_user_id uuid,
  p_amount numeric,
  p_receipt_path text,
  p_note text default null
)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_request_id uuid;
  v_code text;
begin
  if not public.has_permission('manage_fund_requests') then
    raise exception 'Not authorized.';
  end if;
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Customer not found.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Please enter a valid amount.';
  end if;
  if p_receipt_path is null or length(trim(p_receipt_path)) = 0 then
    raise exception 'Please upload the payment screenshot.';
  end if;

  v_code := public.generate_code('FR');

  insert into public.fund_requests(request_code, user_id, amount, status, attempt_number, submitted_by_admin_id, admin_submission_note)
  values (v_code, p_user_id, p_amount, 'pending', 1, v_admin, nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_request_id;

  insert into public.fund_request_receipts(fund_request_id, storage_path, attempt_number)
  values (v_request_id, p_receipt_path, 1);

  perform public.write_audit_log('fund_request_created_by_admin', 'fund_request', v_request_id::text,
    '{}'::jsonb, jsonb_build_object('user_id', p_user_id, 'amount', p_amount), p_note);

  -- Reuses the exact same "New Fund Request" push/notification every
  -- admin already gets for a customer-submitted one (trg_fund_requests
  -- _notify_admin fires on insert regardless of who created the row) -
  -- nothing else to wire up here.

  return json_build_object('id', v_request_id, 'request_code', v_code);
end;
$$;

grant execute on function public.admin_create_fund_request_for_customer(uuid, numeric, text, text) to authenticated;

-- The "receipts" bucket only let a customer upload into their OWN folder
-- (receipts/<their-uid>/...) - correct for normal self-service uploads,
-- but it means an admin uploading a screenshot into a CUSTOMER's folder
-- on their behalf was silently blocked by this policy. Add a second,
-- admin-only policy alongside the existing one (RLS policies are OR'd
-- together) so an admin can upload into any customer's folder too.
drop policy if exists "receipts_insert_admin_on_behalf" on storage.objects;
create policy "receipts_insert_admin_on_behalf"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'receipts'
  and public.is_admin()
);
