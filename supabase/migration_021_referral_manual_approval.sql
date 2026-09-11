-- =====================================================================
-- BHD FILMS — MIGRATION 021: Optional manual approval for referral bonuses
-- =====================================================================
-- Adds a switch on the Referral Settings page: "Require my approval
-- before paying bonuses." Off by default, so nothing changes for you
-- unless you turn it on.
--
--   OFF (default): exactly like today - the moment a referred customer
--     crosses both thresholds, their referrer is paid automatically.
--
--   ON: the referral instead moves to a "Qualified - Awaiting Approval"
--     state (you get pushed a notification) and sits in a queue on the
--     Referral Settings page. The bonus is only actually credited to the
--     referrer's wallet once a Super Admin clicks Approve there - or the
--     referral can be Rejected instead (no money moves, e.g. if you spot
--     a fake/duplicate account), which never happens automatically.
--
-- This is a safety net against someone creating throwaway accounts to
-- farm the bonus - it doesn't replace the existing protection (a
-- referral's "fund added" total only counts once a real payment receipt
-- has already been manually approved in Fund Requests), it adds a second,
-- optional manual check specifically on the payout itself.
--
-- Safe to run more than once.
-- =====================================================================

alter table public.referral_settings add column if not exists require_manual_approval boolean not null default false;

alter table public.referrals drop constraint if exists referrals_status_check;
alter table public.referrals add constraint referrals_status_check
  check (status in ('pending','qualified','paid','rejected'));

create or replace function public.check_referral_qualification(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ref public.referrals%rowtype;
  v_settings public.referral_settings%rowtype;
  v_total_added numeric;
  v_total_orders numeric;
  v_wallet public.wallets%rowtype;
  v_before numeric;
  v_after numeric;
begin
  select * into v_ref from public.referrals where referred_id = p_user_id and status = 'pending' for update;
  if v_ref.id is null then
    return; -- this person was never referred, or is already qualified/paid/rejected
  end if;

  select * into v_settings from public.referral_settings where id = true;
  if v_settings is null or not v_settings.is_enabled then
    return;
  end if;

  -- Y: only counts real approved deposits (type = 'fund_added'), never a
  -- manual admin wallet adjustment - so a "Modify Fund" credit on the
  -- Customer Detail page can never accidentally trigger a referral payout.
  select coalesce(sum(amount), 0) into v_total_added
    from public.wallet_transactions where user_id = p_user_id and type = 'fund_added';

  -- X: cumulative value of everything they've ordered, excluding orders
  -- that were cancelled or refunded.
  select coalesce(sum(grand_total - discount_amount), 0) into v_total_orders
    from public.orders where user_id = p_user_id and status not in ('cancelled','refunded');

  if v_total_added < v_settings.min_fund_added or v_total_orders < v_settings.min_order_amount then
    return; -- not there yet
  end if;

  -- Manual approval switched on: park it as "qualified" (bonus amount
  -- snapshotted right now, so it can't drift if you change the bonus
  -- amount before getting to approve it) and stop here - no money moves
  -- until a Super Admin approves it from the Referral Settings page.
  if v_settings.require_manual_approval then
    update public.referrals
    set status = 'qualified', bonus_amount = v_settings.bonus_amount, qualified_at = now()
    where id = v_ref.id;

    begin
      perform public.notify_admins(
        'Referral Awaiting Approval',
        'A referral just qualified for a ₹' || v_settings.bonus_amount || ' bonus and needs your approval.',
        '/admin/referral-settings'
      );
    exception when others then
      null; -- safe even if notify_admins() was never set up
    end;

    return;
  end if;

  select * into v_wallet from public.wallets where user_id = v_ref.referrer_id for update;
  if v_wallet is null then
    return;
  end if;

  v_before := v_wallet.available_fund;
  v_after := v_before + v_settings.bonus_amount;

  update public.wallets
  set available_fund = v_after, total_fund_added = total_fund_added + v_settings.bonus_amount, updated_at = now()
  where id = v_wallet.id;

  insert into public.wallet_transactions(wallet_id, user_id, type, amount, balance_before, balance_after, status, remark)
  values (
    v_wallet.id, v_ref.referrer_id, 'referral_bonus', v_settings.bonus_amount, v_before, v_after, 'completed',
    'Referral bonus - the person you referred added funds and placed an order.'
  );

  update public.referrals
  set status = 'paid', bonus_amount = v_settings.bonus_amount, qualified_at = now(), paid_at = now()
  where id = v_ref.id;

  insert into public.notifications(user_id, title, message, type)
  values (v_ref.referrer_id, 'Referral Bonus Received', 'You earned ₹' || v_settings.bonus_amount || ' for your referral!', 'wallet');
  perform public.notify_user(v_ref.referrer_id, 'Referral Bonus 🎉', 'You earned ₹' || v_settings.bonus_amount || ' for your referral!', '/refer');

  perform public.write_audit_log('referral_bonus_paid','referral', v_ref.id::text,
    jsonb_build_object('status','pending'),
    jsonb_build_object('status','paid','bonus_amount', v_settings.bonus_amount, 'referrer_id', v_ref.referrer_id, 'referred_id', p_user_id));
end;
$$;

-- Super Admin only (same reasoning as admin_adjust_wallet - this directly
-- moves money into a customer's wallet, so it's not open to admin/staff).
create or replace function public.admin_review_referral_bonus(p_referral_id uuid, p_action text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_ref public.referrals%rowtype;
  v_wallet public.wallets%rowtype;
  v_before numeric;
  v_after numeric;
begin
  if not public.is_super_admin() then
    raise exception 'Not authorized.';
  end if;
  if p_action not in ('approve','reject') then
    raise exception 'Invalid action.';
  end if;

  select * into v_ref from public.referrals where id = p_referral_id for update;
  if v_ref.id is null then
    raise exception 'Referral not found.';
  end if;
  if v_ref.status <> 'qualified' then
    raise exception 'This referral is not waiting for approval.';
  end if;

  if p_action = 'reject' then
    update public.referrals set status = 'rejected' where id = v_ref.id;

    perform public.write_audit_log('referral_bonus_rejected','referral', v_ref.id::text,
      jsonb_build_object('status','qualified'), jsonb_build_object('status','rejected'));

    return json_build_object('status', 'ok');
  end if;

  -- approve
  select * into v_wallet from public.wallets where user_id = v_ref.referrer_id for update;
  if v_wallet is null then
    raise exception 'Referrer wallet not found.';
  end if;

  v_before := v_wallet.available_fund;
  v_after := v_before + v_ref.bonus_amount;

  update public.wallets
  set available_fund = v_after, total_fund_added = total_fund_added + v_ref.bonus_amount, updated_at = now()
  where id = v_wallet.id;

  insert into public.wallet_transactions(wallet_id, user_id, type, amount, balance_before, balance_after, status, remark, created_by_admin_id)
  values (
    v_wallet.id, v_ref.referrer_id, 'referral_bonus', v_ref.bonus_amount, v_before, v_after, 'completed',
    'Referral bonus - the person you referred added funds and placed an order.', v_admin
  );

  update public.referrals set status = 'paid', paid_at = now() where id = v_ref.id;

  insert into public.notifications(user_id, title, message, type)
  values (v_ref.referrer_id, 'Referral Bonus Received', 'You earned ₹' || v_ref.bonus_amount || ' for your referral!', 'wallet');
  perform public.notify_user(v_ref.referrer_id, 'Referral Bonus 🎉', 'You earned ₹' || v_ref.bonus_amount || ' for your referral!', '/refer');

  perform public.write_audit_log('referral_bonus_approved','referral', v_ref.id::text,
    jsonb_build_object('status','qualified'),
    jsonb_build_object('status','paid','bonus_amount', v_ref.bonus_amount, 'referrer_id', v_ref.referrer_id, 'referred_id', v_ref.referred_id));

  return json_build_object('status', 'ok');
end;
$$;

grant execute on function public.admin_review_referral_bonus(uuid, text) to authenticated;
