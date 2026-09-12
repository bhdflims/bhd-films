-- ============================================================
-- Migration 023: Friendlier default "fund approved" message
-- ============================================================
-- Only change: the default message a customer sees when their fund
-- request is approved (used only when the admin leaves the Remark box
-- with nothing typed / uses the default) now also tells them they can go
-- ahead and place an order. Everything else in this function is
-- unchanged from migration_022.
-- ============================================================

create or replace function public.admin_review_fund_request(p_fund_request_id uuid, p_action text, p_remark text default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_fr public.fund_requests%rowtype;
  v_wallet public.wallets%rowtype;
  v_before numeric;
  v_after numeric;
  v_final_remark text;
begin
  if not public.has_permission('manage_fund_requests') then
    raise exception 'Not authorized.';
  end if;
  if p_action not in ('approve','reject','reupload') then
    raise exception 'Invalid action.';
  end if;

  select * into v_fr from public.fund_requests where id = p_fund_request_id for update;
  if v_fr is null then
    raise exception 'Fund request not found.';
  end if;
  if v_fr.status not in ('pending','under_review') then
    raise exception 'This request has already been reviewed.';
  end if;

  if p_action = 'approve' then
    select * into v_wallet from public.wallets where user_id = v_fr.user_id for update;
    if v_wallet is null then
      raise exception 'Wallet not found for this customer.';
    end if;
    v_before := v_wallet.available_fund;
    v_after := v_before + v_fr.amount;
    v_final_remark := coalesce(nullif(trim(p_remark), ''), 'Fund has been successfully added to your wallet. You can order the service now — best wishes!');

    update public.wallets
    set available_fund = v_after, total_fund_added = total_fund_added + v_fr.amount, updated_at = now()
    where id = v_wallet.id;

    insert into public.wallet_transactions(wallet_id, user_id, type, amount, balance_before, balance_after, status, remark, related_fund_request_id, created_by_admin_id)
    values (v_wallet.id, v_fr.user_id, 'fund_added', v_fr.amount, v_before, v_after, 'completed', v_final_remark, v_fr.id, v_admin);

    update public.fund_requests
    set status = 'approved', admin_remark = v_final_remark, reviewed_by = v_admin, reviewed_at = now(), updated_at = now()
    where id = v_fr.id;

    insert into public.notifications(user_id, title, message, type, related_id)
    values (v_fr.user_id, 'Funds Approved', v_final_remark, 'fund_request', v_fr.id);
    perform public.notify_user(v_fr.user_id, 'Funds Approved 💰', v_final_remark, '/fund-history');

    perform public.write_audit_log('fund_approved','fund_request', v_fr.id::text,
      jsonb_build_object('status', v_fr.status), jsonb_build_object('status','approved','amount', v_fr.amount), v_final_remark);

    perform public.check_referral_qualification(v_fr.user_id);

  elsif p_action = 'reject' then
    v_final_remark := coalesce(nullif(trim(p_remark), ''), 'Payment could not be verified.');
    update public.fund_requests
    set status = 'rejected', admin_remark = v_final_remark, reviewed_by = v_admin, reviewed_at = now(), updated_at = now()
    where id = v_fr.id;

    insert into public.notifications(user_id, title, message, type, related_id)
    values (v_fr.user_id, 'Fund Request Rejected', v_final_remark, 'fund_request', v_fr.id);
    perform public.notify_user(v_fr.user_id, 'Fund Request Rejected', v_final_remark, '/fund-requests');

    perform public.write_audit_log('fund_rejected','fund_request', v_fr.id::text,
      jsonb_build_object('status', v_fr.status), jsonb_build_object('status','rejected'), v_final_remark);

  else -- reupload
    v_final_remark := coalesce(nullif(trim(p_remark), ''), 'Please re-upload a clearer receipt.');
    update public.fund_requests
    set status = 'reupload_required', admin_remark = v_final_remark, reviewed_by = v_admin, reviewed_at = now(), updated_at = now()
    where id = v_fr.id;

    insert into public.notifications(user_id, title, message, type, related_id)
    values (v_fr.user_id, 'Re-upload Required', v_final_remark, 'fund_request', v_fr.id);
    perform public.notify_user(v_fr.user_id, 'Re-upload Required', v_final_remark, '/fund-requests');

    perform public.write_audit_log('fund_reupload_requested','fund_request', v_fr.id::text,
      jsonb_build_object('status', v_fr.status), jsonb_build_object('status','reupload_required'), v_final_remark);
  end if;

  return json_build_object('status', 'ok');
end;
$$;

grant execute on function public.admin_review_fund_request(uuid, text, text) to authenticated;
