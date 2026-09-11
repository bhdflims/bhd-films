-- =====================================================================
-- BHD FILMS — MIGRATION 016: fix "Set Balance To" silently corrupting
-- a customer's Total Added / Total Used stats
-- =====================================================================
-- admin_adjust_wallet()'s "set" action (Modify Fund -> "Set Balance To")
-- changed available_fund directly but never touched total_fund_added or
-- total_fund_used. Available Fund itself always stayed correct, but the
-- two stat counters could drift further from reality every time "Set
-- Balance To" was used - e.g. add ₹50 (Total Added ₹50), set to ₹0 to
-- undo it, add ₹50 again = Total Added now wrongly shows ₹100 even
-- though the customer only ever really has ₹50.
--
-- This makes "set" keep those two stats honest, the same way "add" and
-- "deduct" already do: raising the balance counts toward Total Added,
-- lowering it counts toward Total Used.
--
-- Safe to run more than once.
-- =====================================================================

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
  if not public.has_permission('manage_wallets') then
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

grant execute on function public.admin_adjust_wallet(uuid, text, numeric, text) to authenticated;
