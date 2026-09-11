-- =====================================================================
-- BHD FILMS — MIGRATION 018: restrict money-moving & destructive
-- actions to Super Admin only, with full audit-log visibility
-- =====================================================================
-- Staff and admin can currently modify a customer's wallet balance
-- directly, delete uploaded files from Storage Cleanup, and delete a
-- live payment QR code. Going forward, only the super_admin role can do
-- any of those three things. Nothing else changes:
--   - Staff/admin still see every page exactly as before (Wallet
--     Transactions, Storage Cleanup, Payment Settings) - only the
--     specific destructive button is now blocked for them.
--   - Staff/admin still fully manage coupons, offers, services,
--     categories, and bulk pricing tiers exactly as today.
--   - Staff/admin still upload/replace a payment QR code exactly as
--     today - only *deleting* one is now super_admin-only.
--   - Receipts (payment proof) were already permanently undeletable by
--     anyone, including super_admin, by original design - unchanged.
--   - Every one of these actions already shows up in Audit Log for
--     table changes (coupons, wallet, QR codes, payment settings, etc.)
--     via the existing write_audit_log()/trigger setup. The one gap was
--     storage-file deletions, which never went through a table
--     INSERT/UPDATE/DELETE and so were invisible in Audit Log - this
--     migration adds a new log_storage_deletion() RPC that the Storage
--     Cleanup page now calls right after every successful delete, so
--     who deleted what is always visible.
--
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. New helper: true only for the super_admin role.
-- ---------------------------------------------------------------------
create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.admin_users where id = auth.uid()) = 'super_admin', false);
$$;

-- ---------------------------------------------------------------------
-- 2. Wallet balance changes (Modify Fund) — super_admin only.
-- ---------------------------------------------------------------------
create or replace function public.admin_adjust_wallet(p_user_id uuid, p_action text, p_amount numeric, p_reason text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_wallet public.wallets%rowtype;
  v_before numeric;
  v_after numeric;
  v_tx_amount numeric;
begin
  -- Wallet balance changes are money-moving, so only a super_admin can
  -- perform them directly - previously any admin/staff with
  -- manage_wallets could.
  if not public.is_super_admin() then
    raise exception 'Not authorized.';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required.';
  end if;
  if p_action not in ('add','deduct','set') then
    raise exception 'Invalid action.';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'Amount must be zero or greater.';
  end if;

  select * into v_wallet from public.wallets where user_id = p_user_id for update;
  if v_wallet is null then
    raise exception 'Wallet not found.';
  end if;

  v_before := v_wallet.available_fund;

  if p_action = 'add' then
    v_after := v_before + p_amount;
    v_tx_amount := p_amount;
    update public.wallets set available_fund = v_after, total_fund_added = total_fund_added + p_amount, updated_at = now() where id = v_wallet.id;
  elsif p_action = 'deduct' then
    if v_before - p_amount < 0 then
      raise exception 'Deduction would make the balance negative. Not allowed.';
    end if;
    v_after := v_before - p_amount;
    v_tx_amount := p_amount;
    update public.wallets set available_fund = v_after, total_fund_used = total_fund_used + p_amount, updated_at = now() where id = v_wallet.id;
  else -- set
    if p_amount < 0 then
      raise exception 'Balance cannot be negative.';
    end if;
    v_after := p_amount;
    v_tx_amount := v_after - v_before;
    if v_tx_amount >= 0 then
      update public.wallets
      set available_fund = v_after, total_fund_added = total_fund_added + v_tx_amount, updated_at = now()
      where id = v_wallet.id;
    else
      update public.wallets
      set available_fund = v_after, total_fund_used = total_fund_used + abs(v_tx_amount), updated_at = now()
      where id = v_wallet.id;
    end if;
  end if;

  insert into public.wallet_transactions(wallet_id, user_id, type, amount, balance_before, balance_after, status, remark, created_by_admin_id)
  values (v_wallet.id, p_user_id, 'adjustment', v_tx_amount, v_before, v_after, 'completed', p_reason, v_admin);

  perform public.write_audit_log('manual_wallet_adjustment','wallet', p_user_id::text,
    jsonb_build_object('balance', v_before), jsonb_build_object('balance', v_after, 'action', p_action, 'amount', p_amount), p_reason);

  insert into public.notifications(user_id, title, message, type)
  values (p_user_id, 'Wallet Updated', 'Your wallet balance was adjusted by an administrator. Reason: ' || p_reason, 'wallet');
  perform public.notify_user(p_user_id, 'Wallet Updated', 'Your wallet balance was adjusted by an administrator. Reason: ' || p_reason, '/wallet');

  return json_build_object('previous_balance', v_before, 'new_balance', v_after);
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Deleting a live payment QR code — super_admin only. Uploading /
--    replacing one is untouched (payment_qr_codes_insert/_update below
--    still use manage_payment_settings, so admin/staff keep that).
-- ---------------------------------------------------------------------
drop policy if exists "payment_qr_codes_delete" on public.payment_qr_codes;
create policy "payment_qr_codes_delete" on public.payment_qr_codes
  for delete using (public.is_super_admin());

-- ---------------------------------------------------------------------
-- 4. Storage Cleanup deletions — super_admin only. These are the RLS
--    policies that actually authorize supabase.storage.remove() calls.
-- ---------------------------------------------------------------------
drop policy if exists "payment_qr_admin_delete" on storage.objects;
create policy "payment_qr_admin_delete"
on storage.objects for delete to authenticated
using (bucket_id = 'payment-qr' and public.is_super_admin());

drop policy if exists "payment_qr_delete_storage_cleanup" on storage.objects;
create policy "payment_qr_delete_storage_cleanup"
on storage.objects for delete to authenticated
using (bucket_id = 'payment-qr' and public.is_super_admin());

drop policy if exists "support_attachments_delete_admin" on storage.objects;
create policy "support_attachments_delete_admin"
on storage.objects for delete to authenticated
using (
  bucket_id = 'support-attachments'
  and public.is_super_admin()
);

drop policy if exists "refund_receipts_delete_admin" on storage.objects;
create policy "refund_receipts_delete_admin"
on storage.objects for delete to authenticated
using (
  bucket_id = 'refund-receipts'
  and public.is_super_admin()
);

drop policy if exists "refund_customer_proof_delete_admin" on storage.objects;
create policy "refund_customer_proof_delete_admin"
on storage.objects for delete to authenticated
using (
  bucket_id = 'refund-customer-proof'
  and public.is_super_admin()
);

-- ---------------------------------------------------------------------
-- 5. Defense-in-depth: the two old RPC-based delete functions are no
--    longer called by the app (Storage Cleanup now deletes via the real
--    Storage API instead - see migration_017), but they still exist and
--    are still callable, so their own internal checks are hardened to
--    match.
-- ---------------------------------------------------------------------
create or replace function public.storage_delete_qr_orphans()
returns table(deleted_count int, freed_bytes bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_bytes bigint;
begin
  if not public.is_super_admin() then
    raise exception 'Not authorized.';
  end if;
  select count(*), coalesce(sum((o.metadata->>'size')::bigint), 0) into v_count, v_bytes
    from storage.objects o
    where o.bucket_id = 'payment-qr'
      and o.name not in (select qr_image_path from public.payment_qr_codes where qr_image_path is not null);

  delete from storage.objects o
    where o.bucket_id = 'payment-qr'
      and o.name not in (select qr_image_path from public.payment_qr_codes where qr_image_path is not null);

  return query select v_count, v_bytes;
end;
$$;

create or replace function public.storage_delete_files(p_bucket text, p_names text[])
returns table(deleted_count int, freed_bytes bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_bytes bigint;
begin
  if not public.is_super_admin() then
    raise exception 'Not authorized.';
  end if;
  if p_bucket = 'receipts' then
    raise exception 'Payment receipts are protected and cannot be deleted.';
  end if;
  if p_bucket not in ('support-attachments','refund-receipts','refund-customer-proof','payment-qr') then
    raise exception 'Unknown bucket.';
  end if;
  if p_names is null or array_length(p_names, 1) is null then
    raise exception 'No files selected.';
  end if;

  select count(*), coalesce(sum((o.metadata->>'size')::bigint), 0) into v_count, v_bytes
    from storage.objects o
    where o.bucket_id = p_bucket and o.name = any(p_names);

  delete from storage.objects o
    where o.bucket_id = p_bucket and o.name = any(p_names);

  return query select v_count, v_bytes;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. New: log_storage_deletion() — closes the audit-log gap for storage
--    deletions (they never fire a table trigger, since they happen
--    through the Storage API, not a table DELETE). The Storage Cleanup
--    page calls this right after every successful
--    supabase.storage.remove() so who-deleted-what is always visible in
--    Audit Log, same as every other destructive action.
-- ---------------------------------------------------------------------
create or replace function public.log_storage_deletion(p_bucket text, p_names text[], p_freed_bytes bigint default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then
    raise exception 'Not authorized.';
  end if;
  if p_names is null or array_length(p_names, 1) is null then
    raise exception 'No files given.';
  end if;
  perform public.write_audit_log(
    'storage_files_deleted', 'storage', p_bucket,
    null,
    jsonb_build_object('bucket', p_bucket, 'file_count', array_length(p_names, 1), 'names', to_jsonb(p_names), 'freed_bytes', p_freed_bytes),
    null
  );
end;
$$;

grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.log_storage_deletion(text, text[], bigint) to authenticated;
