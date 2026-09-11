-- ============================================================
-- Migration 022: Custom Comments (per-order customer comments)
-- ============================================================
-- Lets an admin mark a service (e.g. "Instagram Comments") as needing
-- the CUSTOMER's own comment text instead of / alongside a target link.
-- The customer types one comment per line, capped to their selected
-- quantity - fewer lines is fine, more is blocked, both in the browser
-- and (again, from scratch) here on the server so it can never be
-- bypassed.
-- ============================================================

alter table public.services
  add column if not exists requires_custom_comments boolean not null default false;

alter table public.order_items
  add column if not exists custom_comments text;

-- Replaces place_order() to also accept + validate + store a
-- `custom_comments` field per item (only enforced when the service's
-- requires_custom_comments flag is on). Everything else in this
-- function is unchanged from migration_021.
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
  v_comments text;
  v_comment_lines text[];
  v_comment_count int;
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

  -- Dropped and recreated fresh every call (rather than "if not exists")
  -- so a pooled/reused connection can never be left holding a stale
  -- column set from before a migration added a new column here.
  drop table if exists tmp_order_items;
  create temporary table tmp_order_items (
    service_id uuid, service_name text, service_external_id int, is_fixed_price boolean, target_link text, quantity int, applied_rate numeric, item_total numeric, custom_comments text
  ) on commit drop;

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

    -- Custom comments: one comment per line, capped to the quantity
    -- ordered (fewer is fine, more is not) - re-checked here from
    -- scratch since the browser-side cap can always be bypassed.
    v_comments := nullif(v_item->>'custom_comments', '');
    if v_service.requires_custom_comments then
      select array_agg(trim(line)) into v_comment_lines
        from unnest(string_to_array(coalesce(v_comments, ''), E'\n')) as line
        where trim(line) <> '';
      v_comment_count := coalesce(array_length(v_comment_lines, 1), 0);
      if v_comment_count = 0 then
        raise exception '%: please enter at least one comment.', v_service.name;
      end if;
      if v_comment_count > v_qty then
        raise exception '%: you entered % comments but only selected a quantity of %. Please enter % or fewer.', v_service.name, v_comment_count, v_qty, v_qty;
      end if;
      v_comments := array_to_string(v_comment_lines, E'\n');
    else
      v_comments := null;
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

    -- v_rate is the CUSTOMER RATE PER 1,000 units, so the charge for this
    -- line is (rate / 1000) * quantity, not rate * quantity - UNLESS this
    -- is a fixed-price package (e.g. YouTube Watch Time), where v_rate
    -- IS the flat price regardless of quantity (quantity is locked to 1
    -- by the service's own min/max_quantity = 1/1).
    if v_service.is_fixed_price then
      v_item_total := round(v_rate, 2);
    else
      v_item_total := round(v_rate * v_qty / 1000, 2);
    end if;
    v_grand_total := v_grand_total + v_item_total;

    insert into tmp_order_items(service_id, service_name, service_external_id, is_fixed_price, target_link, quantity, applied_rate, item_total, custom_comments)
    values (v_service.id, v_service.name, v_service.external_service_id, v_service.is_fixed_price, v_target, v_qty, v_rate, v_item_total, v_comments);

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

  insert into public.order_items(order_id, service_id, service_name_snapshot, service_external_id_snapshot, is_fixed_price_snapshot, target_link, quantity, applied_rate, item_total, custom_comments)
  select v_order_id, service_id, service_name, service_external_id, is_fixed_price, target_link, quantity, applied_rate, item_total, custom_comments from tmp_order_items;

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

  perform public.check_referral_qualification(v_user);

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
