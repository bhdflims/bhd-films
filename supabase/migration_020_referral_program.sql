-- =====================================================================
-- BHD FILMS — MIGRATION 020: Refer & Earn program
-- =====================================================================
-- How it works, end to end:
--   1. Every customer (new AND existing) gets a personal referral_code
--      and a shareable link (shown on the new "Refer & Earn" page).
--   2. Someone opens that link, signs up, and their account is linked to
--      the referrer the moment they log in for the very first time -
--      but ONLY if the account is genuinely brand new (no wallet
--      activity, no orders yet). An existing customer who happens to
--      click a referral link later is never retroactively linked - this
--      is what makes the program "new signups only, going forward".
--   3. As soon as that new customer's LIFETIME totals reach BOTH:
--        - money added to wallet (via approved fund requests) >= Y
--        - money spent on orders (placed, not cancelled/refunded) >= X
--      ...the referrer is automatically paid Z rupees into their own
--      wallet as a "Referral Bonus" - no admin action needed. This is
--      checked the instant a qualifying fund request is approved or a
--      qualifying order is placed, whichever happens to cross the
--      threshold last.
--   4. Y, X and Z (and an on/off switch) all live in one settings row,
--      editable only by a Super Admin, from the new "Referral Settings"
--      admin page.
--   5. One person can only ever be referred ONCE, by ONE referrer, for
--      their whole lifetime on the app (enforced by a database-level
--      unique constraint, not just app logic).
--
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. profiles.referral_code — every customer's own shareable code
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists referral_code text unique;

create or replace function public.generate_referral_code()
returns text
language plpgsql volatile as $$
declare
  v_code text;
begin
  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.profiles where referral_code = v_code);
  end loop;
  return v_code;
end;
$$;

-- Backfill every existing customer with a code too, one at a time (not a
-- single bulk UPDATE) so each new code is checked against the ones just
-- assigned earlier in this same run, not only against codes that existed
-- before the migration started.
do $$
declare
  r record;
begin
  for r in select id from public.profiles where referral_code is null loop
    update public.profiles set referral_code = public.generate_referral_code() where id = r.id;
  end loop;
end;
$$;

-- New signups get a code automatically from now on too.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_username text;
begin
  v_username := lower(regexp_replace(coalesce(split_part(new.email, '@', 1), 'user'), '[^a-zA-Z0-9_]', '', 'g'))
                || '_' || substr(replace(new.id::text, '-', ''), 1, 6);

  insert into public.profiles(id, username, full_name, email, referral_code)
  values (
    new.id, v_username,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email,'@',1)),
    new.email, public.generate_referral_code()
  )
  on conflict (id) do nothing;

  insert into public.wallets(user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. referral_settings — the Y / X / Z knobs, Super Admin only
-- ---------------------------------------------------------------------
create table if not exists public.referral_settings (
  id boolean primary key default true check (id),
  is_enabled boolean not null default true,
  min_fund_added numeric(12,2) not null default 200,   -- Y: cumulative fund added by the referred customer
  min_order_amount numeric(12,2) not null default 100,  -- X: cumulative order value placed by the referred customer
  bonus_amount numeric(12,2) not null default 31,       -- Z: rupees paid to the referrer
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.referral_settings (id) values (true) on conflict (id) do nothing;

alter table public.referral_settings enable row level security;

drop policy if exists "referral_settings_select" on public.referral_settings;
create policy "referral_settings_select" on public.referral_settings
  for select using (auth.role() = 'authenticated' or public.is_admin());

drop policy if exists "referral_settings_update" on public.referral_settings;
create policy "referral_settings_update" on public.referral_settings
  for update using (public.is_super_admin()) with check (public.is_super_admin());

drop trigger if exists trg_referral_settings_updated on public.referral_settings;
create trigger trg_referral_settings_updated before update on public.referral_settings for each row execute function public.set_updated_at();

create or replace function public.log_referral_settings_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.write_audit_log('referral_settings_changed','referral_settings','main', to_jsonb(old), to_jsonb(new));
  return new;
end;
$$;

drop trigger if exists trg_referral_settings_audit on public.referral_settings;
create trigger trg_referral_settings_audit
  after update on public.referral_settings
  for each row execute function public.log_referral_settings_audit();

-- ---------------------------------------------------------------------
-- 3. referrals — one row per successful referral link (referrer -> referred)
-- ---------------------------------------------------------------------
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  referred_id uuid not null unique references public.profiles(id) on delete cascade,
  referred_email text,
  referral_code_used text,
  status text not null default 'pending' check (status in ('pending','qualified','paid')),
  bonus_amount numeric(12,2),
  qualified_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  constraint referrals_no_self_referral check (referrer_id <> referred_id)
);

create index if not exists idx_referrals_referrer on public.referrals(referrer_id);

alter table public.referrals enable row level security;

-- Only the referrer (their own list) or an admin can read referral rows -
-- there are no insert/update/delete policies at all, because every write
-- goes exclusively through claim_referral_code() / check_referral_qualification()
-- below (both SECURITY DEFINER), never directly from the app.
drop policy if exists "referrals_select" on public.referrals;
create policy "referrals_select" on public.referrals
  for select using (referrer_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- 4. wallet_transactions - add the 'referral_bonus' ledger type
-- ---------------------------------------------------------------------
alter table public.wallet_transactions drop constraint if exists wallet_transactions_type_check;
alter table public.wallet_transactions add constraint wallet_transactions_type_check
  check (type in ('fund_added','fund_used','adjustment','refund','referral_bonus'));

-- ---------------------------------------------------------------------
-- 5. claim_referral_code(code) — called once, right after a customer's
--    very first login, if they arrived via a referral link.
-- ---------------------------------------------------------------------
create or replace function public.claim_referral_code(p_code text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_code text := upper(trim(coalesce(p_code, '')));
  v_referrer uuid;
  v_has_activity boolean;
begin
  if v_user is null then
    raise exception 'You must be logged in.';
  end if;
  if length(v_code) = 0 then
    return json_build_object('status','invalid_code');
  end if;

  -- One referral per person, ever. Calling this again after a person is
  -- already linked (or already tried and failed) is always safe - it
  -- just reports back what already happened instead of raising.
  if exists (select 1 from public.referrals where referred_id = v_user) then
    return json_build_object('status','already_claimed');
  end if;

  select id into v_referrer from public.profiles where referral_code = v_code;
  if v_referrer is null then
    return json_build_object('status','invalid_code');
  end if;
  if v_referrer = v_user then
    return json_build_object('status','self_referral');
  end if;

  -- Only a genuinely fresh account (no wallet activity, no orders yet)
  -- can ever be linked as someone's referral. This is what enforces
  -- "new signups only, going forward" - an existing, already-active
  -- customer can never be pulled in as someone's referral after the fact.
  select exists(select 1 from public.wallet_transactions where user_id = v_user)
      or exists(select 1 from public.orders where user_id = v_user)
    into v_has_activity;
  if v_has_activity then
    return json_build_object('status','not_eligible');
  end if;

  begin
    insert into public.referrals(referrer_id, referred_id, referred_email, referral_code_used, status)
    select v_referrer, v_user, email, v_code, 'pending' from public.profiles where id = v_user;
  exception when unique_violation then
    return json_build_object('status','already_claimed');
  end;

  return json_build_object('status', 'ok');
end;
$$;

grant execute on function public.claim_referral_code(text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. check_referral_qualification(user_id) — internal only. Called from
--    place_order() and admin_review_fund_request()'s approve branch
--    every time either of those happens, for whoever the customer is.
--    Cheap no-op unless that customer is someone's still-pending
--    referral AND both thresholds are now met.
-- ---------------------------------------------------------------------
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
    return; -- this person was never referred, or is already qualified/paid
  end if;

  select * into v_settings from public.referral_settings where id = true;
  if v_settings is null or not v_settings.is_enabled then
    return;
  end if;

  -- Y: only counts real approved deposits (type = 'fund_added'), never a
  -- manual admin wallet adjustment - so "Modify Fund" credits on the
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

-- ---------------------------------------------------------------------
-- 7. Hook the qualification check into the two places money moves for a
--    customer: an approved fund request, and placing an order.
-- ---------------------------------------------------------------------
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
    v_final_remark := coalesce(nullif(trim(p_remark), ''), 'Fund has been successfully added to your wallet.');

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

  if p_coupon_code is not null and length(trim(p_coupon_code)) > 0 then
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
