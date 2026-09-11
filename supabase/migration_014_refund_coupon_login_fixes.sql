-- =====================================================================
-- BHD FILMS — MIGRATION 014: full audit fixes (Sep 2026)
-- =====================================================================
-- Three separate fixes from a full audit of the wallet ledger, coupon
-- system and customer login flow:
--
-- 1. admin_review_refund_request() could double-credit a customer's
--    wallet if the SAME order was also cancelled/refunded from the
--    Orders page (admin_update_order_status already guards against this
--    on its own side, but the Refund Requests side had no matching
--    check). Now it locks the order row and refuses to approve if that
--    order was already refunded either way.
--
-- 2. place_order() checked a coupon's usage limits and then used it
--    without locking the coupon row first, so two orders placed at
--    nearly the same moment could both slip past the limit check before
--    either one's usage was recorded - letting a coupon be used more
--    times than intended. Now the coupon row is locked first, so the
--    second order always sees the first one's usage before deciding.
--
-- (The customer-login fix - suspended accounts now actually get signed
-- out instead of the "Suspended" badge being cosmetic - and the Google
-- sign-in redirect fix are both pure front-end changes with no SQL.)
--
-- Safe to run more than once.
-- =====================================================================

create or replace function public.admin_review_refund_request(
  p_refund_request_id uuid,
  p_action text,
  p_remark text default null,
  p_resolution_method text default null,
  p_receipt_path text default null,
  p_delivered_quantity int default null,
  p_amount numeric default null
)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_rr public.refund_requests%rowtype;
  v_order public.orders%rowtype;
  v_wallet public.wallets%rowtype;
  v_before numeric;
  v_after numeric;
  v_final_remark text;
  v_final_amount numeric;
  v_already_refunded boolean;
begin
  if not public.has_permission('manage_refunds') then
    raise exception 'Not authorized.';
  end if;
  if p_action not in ('approve','reject') then
    raise exception 'Invalid action.';
  end if;

  select * into v_rr from public.refund_requests where id = p_refund_request_id for update;
  if v_rr is null then
    raise exception 'Refund request not found.';
  end if;
  if v_rr.status <> 'pending' then
    raise exception 'This request has already been reviewed.';
  end if;

  if p_action = 'approve' then
    if p_resolution_method not in ('wallet','bank') then
      raise exception 'Choose how this refund was paid: wallet or bank.';
    end if;
    if p_resolution_method = 'bank' and (p_receipt_path is null or length(trim(p_receipt_path)) = 0) then
      raise exception 'Upload proof of payment before marking this as paid via bank/UPI.';
    end if;

    -- Lock the order row too (same order as admin_update_order_status:
    -- orders before wallets, so the two functions can never deadlock
    -- against each other), then check whether this exact order was
    -- ALREADY refunded via the other path (an admin cancelling/refunding
    -- it directly from the Orders page). Without this, an order refunded
    -- there and a separately-submitted refund request for the same order
    -- could both credit the customer's wallet - a real double payout.
    select * into v_order from public.orders where id = v_rr.order_id for update;
    if v_order is not null then
      if v_order.status in ('cancelled','refunded') then
        raise exception 'This order has already been cancelled/refunded (likely from the Orders page). Please reject this request instead, or check Wallet Transactions before proceeding.';
      end if;
      select exists(
        select 1 from public.wallet_transactions
        where related_order_id = v_rr.order_id and type = 'refund'
      ) into v_already_refunded;
      if v_already_refunded then
        raise exception 'This order has already been refunded once. Please reject this request instead, or check Wallet Transactions before proceeding.';
      end if;
    end if;

    v_final_amount := coalesce(p_amount, v_rr.amount);
    if v_final_amount is null or v_final_amount <= 0 then
      raise exception 'Enter a valid refund amount.';
    end if;

    if p_resolution_method = 'wallet' then
      select * into v_wallet from public.wallets where user_id = v_rr.user_id for update;
      if v_wallet is null then
        raise exception 'Wallet not found for this customer.';
      end if;
      v_before := v_wallet.available_fund;
      v_after := v_before + v_final_amount;
      v_final_remark := coalesce(nullif(trim(p_remark), ''), 'Refund has been added to your wallet.');

      update public.wallets
      set available_fund = v_after,
          total_fund_used = greatest(total_fund_used - v_final_amount, 0),
          total_fund_refunded = total_fund_refunded + v_final_amount,
          updated_at = now()
      where id = v_wallet.id;

      insert into public.wallet_transactions (wallet_id, user_id, type, amount, balance_before, balance_after, status, remark, related_order_id, created_by_admin_id)
      values (v_wallet.id, v_rr.user_id, 'refund', v_final_amount, v_before, v_after, 'completed', v_final_remark, v_rr.order_id, v_admin);
    else
      select * into v_wallet from public.wallets where user_id = v_rr.user_id for update;
      v_final_remark := coalesce(nullif(trim(p_remark), ''), 'Refund has been paid to your bank/UPI. See receipt for proof.');

      if v_wallet is not null then
        update public.wallets
        set total_fund_used = greatest(total_fund_used - v_final_amount, 0),
            total_fund_refunded = total_fund_refunded + v_final_amount,
            updated_at = now()
        where id = v_wallet.id;

        insert into public.wallet_transactions (wallet_id, user_id, type, amount, balance_before, balance_after, status, remark, related_order_id, created_by_admin_id)
        values (v_wallet.id, v_rr.user_id, 'refund', v_final_amount, v_wallet.available_fund, v_wallet.available_fund, 'completed',
          'Paid via bank/UPI directly - record only, wallet balance unchanged. ' || v_final_remark, v_rr.order_id, v_admin);
      end if;
    end if;

    update public.refund_requests
    set status = 'approved', resolution_method = p_resolution_method, receipt_path = p_receipt_path,
        delivered_quantity = p_delivered_quantity, admin_remark = v_final_remark,
        approved_amount = v_final_amount,
        reviewed_by = v_admin, reviewed_at = now(), updated_at = now()
    where id = v_rr.id;

    update public.orders set status = 'refunded', updated_at = now() where id = v_rr.order_id;
    perform public.release_coupon_redemption_for_order(v_rr.order_id);

    insert into public.notifications (user_id, title, message, type, related_id)
    values (v_rr.user_id, 'Refund Approved',
      v_final_remark || ' Amount: ' || to_char(v_final_amount, 'FM999999990'), 'refund_request', v_rr.id);
    perform public.notify_user(v_rr.user_id, 'Refund Approved 💸',
      v_final_remark || ' Amount: ₹' || to_char(v_final_amount, 'FM999999990'), '/orders');

    perform public.write_audit_log('refund_approved', 'refund_request', v_rr.id::text,
      jsonb_build_object('status', v_rr.status),
      jsonb_build_object('status', 'approved', 'method', p_resolution_method, 'amount', v_final_amount),
      v_final_remark);

  else -- reject
    v_final_remark := coalesce(nullif(trim(p_remark), ''), 'This refund request was not approved.');
    update public.refund_requests
    set status = 'rejected', delivered_quantity = p_delivered_quantity, admin_remark = v_final_remark,
        reviewed_by = v_admin, reviewed_at = now(), updated_at = now()
    where id = v_rr.id;

    insert into public.notifications (user_id, title, message, type, related_id)
    values (v_rr.user_id, 'Refund Request Rejected', v_final_remark, 'refund_request', v_rr.id);
    perform public.notify_user(v_rr.user_id, 'Refund Request Rejected', v_final_remark, '/orders');

    perform public.write_audit_log('refund_rejected', 'refund_request', v_rr.id::text,
      jsonb_build_object('status', v_rr.status), jsonb_build_object('status', 'rejected'), v_final_remark);
  end if;

  return json_build_object('status', 'ok');
end;
$$;

grant execute on function public.admin_review_refund_request(uuid, text, text, text, text, int, numeric) to authenticated;

-- ---------------------------------------------------------------------

create or replace function public.place_order(p_items jsonb, p_idempotency_key uuid default null, p_coupon_code text default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_item jsonb;
  v_service public.services%rowtype;
  v_tier public.service_price_tiers%rowtype;
  v_qty int;
  v_target text;
  v_rate numeric;
  v_item_total numeric;
  v_grand_total numeric := 0;
  v_category_id uuid;
  v_category_name text;
  v_order_id uuid;
  v_wallet public.wallets%rowtype;
  v_before numeric;
  v_after numeric;
  v_order_code text;
  v_est_time text;
  v_existing uuid;
  v_coupon public.coupons%rowtype;
  v_coupon_id uuid;
  v_discount_amount numeric := 0;
  v_payable_total numeric;
begin
  if v_user is null then
    raise exception 'You must be logged in to place an order.';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'No services selected.';
  end if;

  if p_idempotency_key is not null then
    select id into v_existing from public.orders where idempotency_key = p_idempotency_key;
    if v_existing is not null then
      return (select json_build_object(
                'order_id', id, 'order_code', order_code, 'grand_total', grand_total,
                'discount_amount', discount_amount, 'coupon_code', coupon_code,
                'payable_total', grand_total - discount_amount, 'already_existed', true)
              from public.orders where id = v_existing);
    end if;
  end if;

  select * into v_wallet from public.wallets where user_id = v_user for update;
  if v_wallet is null then
    raise exception 'Wallet not found.';
  end if;

  create temporary table if not exists tmp_order_items (
    service_id uuid, service_name text, service_external_id int, is_fixed_price boolean, target_link text, quantity int, applied_rate numeric, item_total numeric
  ) on commit drop;
  delete from tmp_order_items where true;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_service from public.services where id = (v_item->>'service_id')::uuid and is_active = true;
    if v_service.id is null then
      raise exception 'One of the selected services is no longer available.';
    end if;

    v_qty := nullif(v_item->>'quantity','')::int;
    if v_qty is null or v_qty <= 0 then
      raise exception '%: please enter a valid quantity.', v_service.name;
    end if;
    if v_qty < v_service.min_quantity then
      raise exception '%: minimum quantity is %.', v_service.name, v_service.min_quantity;
    end if;
    if v_qty > v_service.max_quantity then
      raise exception '%: maximum quantity is %.', v_service.name, v_service.max_quantity;
    end if;

    v_target := nullif(trim(v_item->>'target_link'), '');
    if v_service.requires_target_link then
      if v_target is null or not public.validate_target_link(v_service.target_platform, v_target) then
        raise exception '%: please enter a valid % link.', v_service.name, initcap(v_service.target_platform);
      end if;
    end if;

    select * into v_tier from public.service_price_tiers
      where service_id = v_service.id and is_active = true
        and v_qty >= min_quantity and (max_quantity is null or v_qty <= max_quantity)
      order by min_quantity desc
      limit 1;

    if v_tier.id is not null then
      v_rate := v_tier.rate;
    else
      v_rate := v_service.base_rate;
    end if;

    if v_service.is_fixed_price then
      v_item_total := round(v_rate, 2);
    else
      v_item_total := round(v_rate * v_qty / 1000, 2);
    end if;
    v_grand_total := v_grand_total + v_item_total;

    insert into tmp_order_items(service_id, service_name, service_external_id, is_fixed_price, target_link, quantity, applied_rate, item_total)
    values (v_service.id, v_service.name, v_service.external_service_id, v_service.is_fixed_price, v_target, v_qty, v_rate, v_item_total);

    if v_category_id is null then
      v_category_id := v_service.category_id;
      select name into v_category_name from public.categories where id = v_category_id;
    end if;
    if v_est_time is null then
      v_est_time := v_service.estimated_time_text;
    end if;

    v_tier := null;
  end loop;

  -- Coupon: re-validated here from scratch (never trust a discount
  -- amount computed in the browser) using the exact same rules as
  -- validate_coupon above.
  if p_coupon_code is not null and length(trim(p_coupon_code)) > 0 then
    -- Lock this coupon's row before checking/using it. Without this, two
    -- orders placed at nearly the same moment (by the same customer, or
    -- different customers on a limited-total coupon) could both pass the
    -- usage-limit checks below before either one's redemption row exists,
    -- letting a coupon get used more times than its limit allows. The
    -- lock makes the second order wait until the first one fully commits,
    -- so its count/limit checks always see the first order's redemption.
    select * into v_coupon from public.coupons where upper(code) = upper(trim(p_coupon_code)) for update;
    if v_coupon.id is null then
      raise exception 'Invalid coupon code.';
    end if;
    if not v_coupon.is_active then
      raise exception 'This coupon is no longer active.';
    end if;
    if v_coupon.valid_from is not null and v_coupon.valid_from > current_date then
      raise exception 'This coupon is not active yet.';
    end if;
    if v_coupon.valid_until is not null and v_coupon.valid_until < current_date then
      raise exception 'This coupon has expired.';
    end if;
    if v_grand_total < v_coupon.min_order_amount then
      raise exception 'This coupon needs a minimum order of ₹%.', v_coupon.min_order_amount;
    end if;
    if v_coupon.total_usage_limit is not null and v_coupon.times_used >= v_coupon.total_usage_limit then
      raise exception 'This coupon has reached its usage limit.';
    end if;
    if v_coupon.usage_limit_per_user is not null then
      if (select count(*) from public.coupon_redemptions where coupon_id = v_coupon.id and user_id = v_user) >= v_coupon.usage_limit_per_user then
        raise exception 'You have already used this coupon.';
      end if;
    end if;

    if v_coupon.discount_type = 'percent' then
      v_discount_amount := round(v_grand_total * v_coupon.discount_value / 100, 2);
      if v_coupon.max_discount_amount is not null and v_discount_amount > v_coupon.max_discount_amount then
        v_discount_amount := v_coupon.max_discount_amount;
      end if;
    else
      v_discount_amount := v_coupon.discount_value;
    end if;
    if v_discount_amount > v_grand_total then
      v_discount_amount := v_grand_total;
    end if;

    v_coupon_id := v_coupon.id;
  end if;

  v_payable_total := v_grand_total - v_discount_amount;

  if v_wallet.available_fund < v_payable_total then
    raise exception 'INSUFFICIENT_FUNDS:%', (v_payable_total - v_wallet.available_fund);
  end if;

  v_before := v_wallet.available_fund;
  v_after := v_before - v_payable_total;

  update public.wallets
  set available_fund = v_after, total_fund_used = total_fund_used + v_payable_total, updated_at = now()
  where id = v_wallet.id;

  v_order_code := public.generate_code('BHD');

  insert into public.orders(order_code, user_id, category_id, category_name_snapshot, grand_total, discount_amount, coupon_code, status, estimated_time_text, idempotency_key)
  values (v_order_code, v_user, v_category_id, v_category_name, v_grand_total, v_discount_amount, case when v_coupon_id is not null then v_coupon.code else null end, 'received', v_est_time, p_idempotency_key)
  returning id into v_order_id;

  insert into public.order_items(order_id, service_id, service_name_snapshot, service_external_id_snapshot, is_fixed_price_snapshot, target_link, quantity, applied_rate, item_total)
  select v_order_id, service_id, service_name, service_external_id, is_fixed_price, target_link, quantity, applied_rate, item_total from tmp_order_items;

  insert into public.wallet_transactions(wallet_id, user_id, type, amount, balance_before, balance_after, status, remark, related_order_id)
  values (
    v_wallet.id, v_user, 'fund_used', v_payable_total, v_before, v_after, 'completed',
    'Order ' || v_order_code || case when v_coupon_id is not null then ' (coupon ' || v_coupon.code || ' applied)' else '' end,
    v_order_id
  );

  if v_coupon_id is not null then
    insert into public.coupon_redemptions(coupon_id, user_id, order_id, discount_amount)
    values (v_coupon_id, v_user, v_order_id, v_discount_amount);
    update public.coupons set times_used = times_used + 1 where id = v_coupon_id;
  end if;

  insert into public.notifications(user_id, title, message, type, related_id)
  values (v_user, 'Order Placed', 'Your order ' || v_order_code || ' has been received.', 'order', v_order_id);

  return json_build_object(
    'order_id', v_order_id,
    'order_code', v_order_code,
    'grand_total', v_grand_total,
    'discount_amount', v_discount_amount,
    'coupon_code', case when v_coupon_id is not null then v_coupon.code else null end,
    'payable_total', v_payable_total,
    'remaining_balance', v_after,
    'estimated_time_text', v_est_time
  );
end;
$$;

grant execute on function public.place_order(jsonb, uuid, text) to authenticated;
