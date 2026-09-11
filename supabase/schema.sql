-- =====================================================================
-- BHD FILMS — COMPLETE SUPABASE SCHEMA
-- =====================================================================
-- HOW TO USE:
-- 1. Open your Supabase project -> SQL Editor -> New query.
-- 2. Paste this ENTIRE file and click "Run". It is safe to run once on
--    a fresh project. It creates every table, security rule, trigger
--    and secure function the app needs.
-- 3. After running this, also run supabase/storage.sql (receipts + QR).
-- 4. Then run supabase/seed_admin.sql (replace the email placeholder
--    with YOUR OWN email) to make yourself the first Super Admin.
-- =====================================================================

create extension if not exists pgcrypto;

-- =====================================================================
-- SECTION 1: TABLES
-- =====================================================================

-- Every authenticated user gets exactly one profile row (auto-created).
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  full_name text,
  email text,
  phone text check (phone is null or phone ~ '^[0-9]{10}$'),
  account_status text not null default 'active' check (account_status in ('active','suspended')),
  is_test_account boolean not null default false, -- flip this on for an account you use to test features. Orders/wallet activity from it are excluded from Dashboard and Reports totals.
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

-- Admin panel access. A row here = this auth user is staff/admin/super_admin.
-- Regular customers never have a row in this table.
-- References public.profiles (not auth.users directly) so the admin panel
-- can ask PostgREST to embed the profile (name/email) in one query.
create table public.admin_users (
  id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in ('super_admin','admin','staff')),
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- Categories shown on the customer Home page (e.g. Instagram, Facebook...).
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  icon text not null default 'globe',
  description text,
  display_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Services inside a category (e.g. Instagram -> Followers, Likes...).
-- base_rate is the CUSTOMER RATE PER 1,000 units (not per single unit) -
-- matches how the SMM supplier panel prices things, so admin can paste
-- panel rates in directly. place_order() divides by 1000 when charging.
-- external_service_id is the matching service ID on the supplier's SMM
-- panel - recorded so the admin can tell, from any order, exactly which
-- panel service to fulfil (every panel service has its own distinct
-- price, so the name alone isn't reliable enough to fulfil orders by).
create table public.services (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  name text not null,
  description text,
  external_service_id int not null unique,
  service_group text,
  -- Fixed-price services (e.g. a YouTube Watch Time package) are sold as
  -- ONE flat package, not scaled by quantity - base_rate IS the price,
  -- and min/max_quantity are locked to 1/1. Everything else keeps the
  -- normal per-1,000 convention.
  is_fixed_price boolean not null default false,
  min_quantity int not null default 100 check (min_quantity > 0),
  max_quantity int not null default 100000 check (max_quantity >= min_quantity),
  base_rate numeric(12,4) not null default 0 check (base_rate >= 0),
  requires_target_link boolean not null default true,
  target_platform text not null default 'custom',
  estimated_time_text text not null default '3-5 minutes',
  is_active boolean not null default true,
  is_popular boolean not null default false,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bulk pricing tiers. If a quantity falls inside a tier, the tier rate
-- overrides the service's base_rate.
create table public.service_price_tiers (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  min_quantity int not null check (min_quantity > 0),
  max_quantity int check (max_quantity is null or max_quantity >= min_quantity),
  rate numeric(12,4) not null check (rate >= 0),
  is_active boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Full history of every rate / quantity-limit / status change ever made.
create table public.rate_history (
  id uuid primary key default gen_random_uuid(),
  service_id uuid references public.services(id) on delete set null,
  service_name_snapshot text,
  field_changed text not null,
  previous_value jsonb,
  new_value jsonb,
  admin_id uuid references auth.users(id),
  admin_email text,
  reason text,
  created_at timestamptz not null default now()
);

-- One wallet per customer.
create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  available_fund numeric(12,2) not null default 0 check (available_fund >= 0),
  total_fund_added numeric(12,2) not null default 0,
  total_fund_used numeric(12,2) not null default 0,
  total_fund_refunded numeric(12,2) not null default 0,
  updated_at timestamptz not null default now()
);

-- A customer's request to add money, pending admin verification.
create table public.fund_requests (
  id uuid primary key default gen_random_uuid(),
  request_code text not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'pending' check (status in ('pending','under_review','approved','rejected','reupload_required')),
  admin_remark text,
  attempt_number int not null default 1,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set only when an ADMIN entered this on the customer's behalf (their
  -- own receipt upload failed, so they sent the admin a screenshot
  -- directly, e.g. over WhatsApp) instead of the customer submitting it
  -- themselves through the app. admin_submission_note is the admin's own
  -- context for why, kept visible even after the request is reviewed
  -- (unlike admin_remark, which gets overwritten by the review action).
  submitted_by_admin_id uuid references auth.users(id),
  admin_submission_note text
);

-- Every receipt ever uploaded for a fund request (never deleted).
create table public.fund_request_receipts (
  id uuid primary key default gen_random_uuid(),
  fund_request_id uuid not null references public.fund_requests(id) on delete cascade,
  storage_path text not null,
  attempt_number int not null,
  uploaded_at timestamptz not null default now()
);

-- One row per placed order.
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  category_name_snapshot text,
  grand_total numeric(12,2) not null,
  coupon_code text,
  discount_amount numeric(12,2) not null default 0,
  status text not null default 'received' check (status in ('received','processing','completed','cancelled','refunded')),
  estimated_time_text text,
  idempotency_key uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per service inside an order, with the HISTORICAL rate applied.
-- applied_rate is per 1,000 (same convention as services.base_rate) UNLESS
-- is_fixed_price_snapshot is true, in which case applied_rate IS the flat
-- package price. Snapshotted (not read live) so a later change to the
-- service's pricing mode never rewrites how an old order is displayed.
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  service_name_snapshot text not null,
  service_external_id_snapshot int,
  is_fixed_price_snapshot boolean not null default false,
  target_link text,
  quantity int not null,
  applied_rate numeric(12,4) not null,
  item_total numeric(12,2) not null,
  created_at timestamptz not null default now()
);

-- Customer refund requests. Customers can only ever request "wallet".
-- Admins decide, when reviewing, whether to actually pay it back to the
-- wallet or pay it externally via bank/UPI (uploading a receipt as
-- proof) - see admin_review_refund_request() below.
create table public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  request_code text not null unique,
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null,
  approved_amount numeric(12,2), -- actual amount refunded, may differ from the customer's original ask (e.g. a partial GPay/PhonePe payout)
  ordered_quantity int,
  delivered_quantity int,
  reason text,
  customer_proof_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  resolution_method text check (resolution_method in ('wallet','bank')),
  receipt_path text,
  admin_remark text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every wallet movement, ever. This is the permanent ledger.
create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('fund_added','fund_used','adjustment','refund')),
  amount numeric(12,2) not null,
  balance_before numeric(12,2) not null,
  balance_after numeric(12,2) not null,
  status text not null default 'completed',
  remark text,
  related_order_id uuid references public.orders(id) on delete set null,
  related_fund_request_id uuid references public.fund_requests(id) on delete set null,
  created_by_admin_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Home page promotional offers, fully admin-managed.
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  icon text not null default 'gift',
  gradient text not null default 'gold',
  valid_from date,
  valid_until date,
  is_active boolean not null default true,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Discount / coupon codes, fully admin-managed. Shown on the Home page
-- as a "festive offer" the customer can copy and redeem at checkout.
create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  description text,
  icon text not null default 'gift',
  discount_type text not null default 'fixed' check (discount_type in ('fixed', 'percent')),
  discount_value numeric not null check (discount_value > 0),
  max_discount_amount numeric,
  min_order_amount numeric not null default 0,
  usage_limit_per_user int,
  total_usage_limit int,
  times_used int not null default 0,
  is_active boolean not null default true,
  valid_from date,
  valid_until date,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);

-- One row per time a coupon is actually used on a real order — written
-- only by the place_order RPC, never directly by the browser.
create table public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  discount_amount numeric not null,
  created_at timestamptz not null default now()
);

create index idx_coupon_redemptions_coupon_user on public.coupon_redemptions (coupon_id, user_id);

-- Two-way Support & Smart Ticket System.
-- One row per ticket, auto-linked to the logged-in customer. Optional
-- links to an existing order / wallet transaction / fund request let the
-- app auto-fetch that record's details instead of asking the customer to
-- re-type anything (no snapshot columns needed here on purpose - the
-- admin/customer UI joins the live order/wallet/fund_request row).
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_code text not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('technical','payment','order','wallet','dropped','failed_transaction','receipt','other')),
  sub_category text,
  subject text not null,
  order_id uuid references public.orders(id) on delete set null,
  wallet_transaction_id uuid references public.wallet_transactions(id) on delete set null,
  fund_request_id uuid references public.fund_requests(id) on delete set null,
  transaction_ref text,
  payment_date date,
  amount numeric(12,2),
  failure_message text,
  occurred_location text,
  status text not null default 'open' check (status in ('open','in_progress','waiting_customer','resolved','closed')),
  has_unread_admin_reply boolean not null default false,
  has_unread_customer_message boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

-- The full conversation thread for a ticket (customer + admin messages,
-- in order). is_read means "read by the OTHER party".
create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_type text not null check (sender_type in ('customer','admin')),
  sender_id uuid references auth.users(id),
  message text not null,
  attachment_url text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- Lightweight in-app notifications.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  message text not null,
  type text not null default 'info',
  is_read boolean not null default false,
  related_id uuid,
  created_at timestamptz not null default now()
);

-- Singleton row (id is always TRUE) holding QR / UPI / add-funds settings.
create table public.payment_settings (
  id boolean primary key default true check (id),
  qr_image_path text,
  upi_id text,
  instructions text default 'Scan the QR code and pay the exact amount shown, then upload your payment screenshot below.',
  allow_custom_amount boolean not null default false,
  preset_amounts numeric(12,2)[] not null default array[1,100,200,300,400,500,600,800,900,1000,1500,2000,2500,3000,4000,5000]::numeric(12,2)[],
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

-- Singleton row (id is always TRUE) holding site-wide maintenance mode.
-- Readable by EVERYONE, including logged-out visitors, so the maintenance
-- banner can show before login; only admin/super_admin can update it.
create table public.site_settings (
  id boolean primary key default true check (id),
  maintenance_mode boolean not null default false,
  maintenance_message_en text not null default 'Thank you for your support! We have taken our website under maintenance, we will be back shortly. Orders already placed will still be processed soon.',
  maintenance_message_hi text not null default 'आपके सहयोग के लिए धन्यवाद! हमारी वेबसाइट अभी मेंटेनेंस में है, हम जल्द वापस आएंगे। जिन ऑर्डर की प्रोसेसिंग चल रही है उन्हें जल्द पूरा किया जाएगा।',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

-- One QR code picture per add-funds amount, fully admin-controlled.
-- amount = a specific preset (e.g. 100, 500, 1000) shows that exact QR.
-- amount = null is the fallback/default QR shown for a custom amount that
-- has no dedicated QR of its own (only relevant when allow_custom_amount
-- is enabled). There is at most one row per amount, and at most one
-- fallback row, enforced by the two partial unique indexes below.
create table public.payment_qr_codes (
  id uuid primary key default gen_random_uuid(),
  amount numeric(12,2),
  qr_image_path text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create unique index payment_qr_codes_amount_uidx
  on public.payment_qr_codes (amount) where amount is not null;
create unique index payment_qr_codes_default_uidx
  on public.payment_qr_codes ((amount is null)) where amount is null;

-- Web Push subscriptions (one row per browser/device that opted in).
-- user_id is nullable - even a signed-out visitor can enable notifications
-- for public offers; logged-in customers get it linked to their account.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- Permanent, secure audit trail of every sensitive admin action.
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  entity_type text,
  entity_id text,
  previous_value jsonb,
  new_value jsonb,
  admin_id uuid references auth.users(id),
  admin_email text,
  remark text,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- SECTION 2: INDEXES
-- =====================================================================

create index idx_categories_active_order on public.categories (is_active, display_order);
create index idx_services_category on public.services (category_id);
create index idx_services_active_order on public.services (is_active, display_order);
create index idx_tiers_service on public.service_price_tiers (service_id);
create index idx_rate_history_service on public.rate_history (service_id);
create index idx_wallet_tx_user on public.wallet_transactions (user_id, created_at desc);
create index idx_wallet_tx_wallet on public.wallet_transactions (wallet_id);
create index idx_fund_requests_user on public.fund_requests (user_id, created_at desc);
create index idx_fund_requests_status on public.fund_requests (status);
create index idx_receipts_request on public.fund_request_receipts (fund_request_id);
create index idx_orders_user on public.orders (user_id, created_at desc);
create index idx_orders_status on public.orders (status);
create index idx_order_items_order on public.order_items (order_id);
create index idx_refund_requests_user on public.refund_requests (user_id, created_at desc);
create index idx_refund_requests_order on public.refund_requests (order_id);
create index idx_refund_requests_pending on public.refund_requests (status) where status = 'pending';
create index idx_notifications_user on public.notifications (user_id, is_read);
create index idx_audit_logs_created on public.audit_logs (created_at desc);
create index idx_support_tickets_user on public.support_tickets (user_id, created_at desc);
create index idx_support_tickets_status on public.support_tickets (status);
create index idx_support_tickets_order on public.support_tickets (order_id);
create index idx_support_tickets_unread_admin on public.support_tickets (has_unread_customer_message) where has_unread_customer_message = true;
create index idx_support_messages_ticket on public.support_messages (ticket_id, created_at);
create index idx_push_subs_user on public.push_subscriptions (user_id);

-- =====================================================================
-- SECTION 3: HELPER / SECURITY FUNCTIONS
-- =====================================================================

-- True if the current logged-in user has ANY admin_users row.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where id = auth.uid());
$$;

create or replace function public.current_admin_role()
returns text
language sql stable security definer set search_path = public as $$
  select role from public.admin_users where id = auth.uid();
$$;

-- Central permission check used by every RLS policy and RPC function.
-- super_admin => always true.
-- admin       => true for everything except 'manage_admins'.
-- staff       => only true for permissions explicitly granted in their
--                permissions jsonb, and NEVER for the restricted set
--                (wallets, rates, payment settings, admin management)
--                no matter what their jsonb says.
create or replace function public.has_permission(perm text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text;
  v_perms jsonb;
  v_restricted text[] := array['manage_wallets','manage_rates','manage_bulk_pricing','manage_payment_settings','manage_admins','manage_refunds','manage_storage'];
begin
  select role, permissions into v_role, v_perms from public.admin_users where id = auth.uid();
  if v_role is null then
    return false;
  end if;
  if v_role = 'super_admin' then
    return true;
  end if;
  if v_role = 'admin' then
    return perm <> 'manage_admins';
  end if;
  if v_role = 'staff' then
    if perm = any(v_restricted) then
      return false;
    end if;
    return coalesce((v_perms ->> perm)::boolean, false);
  end if;
  return false;
end;
$$;

create or replace function public.current_admin_email()
returns text
language sql stable security definer set search_path = public as $$
  select email from auth.users where id = auth.uid();
$$;

create or replace function public.generate_code(prefix text)
returns text
language sql volatile as $$
  select prefix || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
$$;

-- Re-implements the exact same target-link rules as the frontend
-- (src/utils/validators.js) so the server never trusts the client.
create or replace function public.validate_target_link(p_platform text, p_url text)
returns boolean
language plpgsql immutable as $$
begin
  if p_url is null or length(trim(p_url)) = 0 then
    return false;
  end if;
  case p_platform
    when 'instagram' then return p_url ~* '^https?://(www\.)?instagram\.com/.+';
    -- fb.watch is Facebook's own share-link domain for video posts.
    when 'facebook' then return p_url ~* '^https?://(www\.)?(facebook\.com|fb\.com|fb\.watch)/.+';
    -- vm./vt. are TikTok's own short-share-link subdomains (what the
    -- app's native "Share" button actually gives you) - must match the
    -- client-side check in src/utils/validators.js exactly, or a link
    -- that passes on-screen still gets rejected here when the order is
    -- actually placed.
    when 'tiktok' then return p_url ~* '^https?://(www\.|vm\.|vt\.|m\.)?tiktok\.com/.+';
    when 'youtube' then return p_url ~* '^https?://(www\.|m\.)?(youtube\.com|youtu\.be)/.+';
    when 'twitter' then return p_url ~* '^https?://(www\.)?(twitter\.com|x\.com)/.+';
    when 'telegram' then return p_url ~* '^https?://(www\.)?(t\.me|telegram\.me)/.+';
    when 'whatsapp' then return p_url ~* '^https?://(www\.)?(wa\.me|chat\.whatsapp\.com)/.+';
    when 'spotify' then return p_url ~* '^https?://(open\.)?spotify\.com/.+';
    when 'threads' then return p_url ~* '^https?://(www\.)?threads\.net/.+';
    when 'linkedin' then return p_url ~* '^https?://(www\.)?linkedin\.com/.+';
    when 'snapchat' then return p_url ~* '^https?://(www\.)?snapchat\.com/.+';
    when 'pinterest' then return p_url ~* '^https?://(www\.)?pinterest\.[a-z.]+/.+';
    else return p_url ~* '^https?://.+';
  end case;
end;
$$;

create or replace function public.write_audit_log(
  p_action text, p_entity_type text, p_entity_id text,
  p_previous jsonb, p_new jsonb, p_remark text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs(action, entity_type, entity_id, previous_value, new_value, admin_id, admin_email, remark)
  values (p_action, p_entity_type, p_entity_id, p_previous, p_new, auth.uid(), public.current_admin_email(), p_remark);
end;
$$;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =====================================================================
-- SECTION 4: NEW-USER SIGNUP (auto profile + wallet)
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_username text;
begin
  v_username := lower(regexp_replace(coalesce(split_part(new.email, '@', 1), 'user'), '[^a-zA-Z0-9_]', '', 'g'))
                || '_' || substr(replace(new.id::text, '-', ''), 1, 6);

  insert into public.profiles(id, username, full_name, email)
  values (new.id, v_username, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email,'@',1)), new.email)
  on conflict (id) do nothing;

  insert into public.wallets(user_id) values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- SECTION 5: updated_at TRIGGERS
-- =====================================================================

create trigger trg_categories_updated before update on public.categories for each row execute function public.set_updated_at();
create trigger trg_services_updated before update on public.services for each row execute function public.set_updated_at();
create trigger trg_wallets_updated before update on public.wallets for each row execute function public.set_updated_at();
create trigger trg_orders_updated before update on public.orders for each row execute function public.set_updated_at();
create trigger trg_fund_requests_updated before update on public.fund_requests for each row execute function public.set_updated_at();
create trigger trg_refund_requests_updated before update on public.refund_requests for each row execute function public.set_updated_at();
create trigger trg_support_tickets_updated before update on public.support_tickets for each row execute function public.set_updated_at();
create trigger trg_payment_settings_updated before update on public.payment_settings for each row execute function public.set_updated_at();
create trigger trg_site_settings_updated before update on public.site_settings for each row execute function public.set_updated_at();
create trigger trg_payment_qr_codes_updated before update on public.payment_qr_codes for each row execute function public.set_updated_at();

-- =====================================================================
-- SECTION 6: PROFILE PROTECTION (customers cannot self-promote / self-unsuspend)
-- =====================================================================

create or replace function public.protect_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    new.account_status := old.account_status;
    new.email := old.email;
    -- The username ("user ID") is generated once at signup and used as a
    -- stable handle for the account - customers can change their display
    -- name and phone number freely, but not this, so it stays a reliable
    -- reference for support/admin lookups over time.
    new.username := old.username;
  end if;
  new.last_activity_at := now();
  return new;
end;
$$;

create trigger trg_protect_profile_fields
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- =====================================================================
-- SECTION 7: RATE / SERVICE / CATEGORY CHANGE HISTORY + AUDIT TRIGGERS
-- =====================================================================

create or replace function public.prevent_category_delete_with_services()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.services where category_id = old.id) then
    raise exception 'Cannot delete this category while it still has services. Delete/move its services first, or deactivate the category instead.';
  end if;
  return old;
end;
$$;

create trigger trg_prevent_category_delete
  before delete on public.categories
  for each row execute function public.prevent_category_delete_with_services();

create or replace function public.log_category_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit_log('category_created','category', new.id::text, null, to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    perform public.write_audit_log('category_updated','category', new.id::text, to_jsonb(old), to_jsonb(new));
  elsif tg_op = 'DELETE' then
    perform public.write_audit_log('category_deleted','category', old.id::text, to_jsonb(old), null);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_categories_audit
  after insert or update or delete on public.categories
  for each row execute function public.log_category_audit();

create or replace function public.log_service_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit_log('service_created','service', new.id::text, null, to_jsonb(new));
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.write_audit_log('service_deleted','service', old.id::text, to_jsonb(old), null);
    return old;
  end if;

  -- UPDATE: log a generic audit entry...
  perform public.write_audit_log('service_updated','service', new.id::text, to_jsonb(old), to_jsonb(new));

  -- ...and a dedicated rate_history row for every rate-relevant field.
  -- (admin_update_service_rate sets this transaction-local setting so the
  -- admin's typed-in reason ends up on the history row; a plain table
  -- update from the Services page just leaves it null.)
  if old.base_rate is distinct from new.base_rate then
    insert into public.rate_history(service_id, service_name_snapshot, field_changed, previous_value, new_value, admin_id, admin_email, reason)
    values (new.id, new.name, 'base_rate', to_jsonb(old.base_rate), to_jsonb(new.base_rate), auth.uid(), public.current_admin_email(), nullif(current_setting('bhd.rate_reason', true), ''));
  end if;
  if old.min_quantity is distinct from new.min_quantity then
    insert into public.rate_history(service_id, service_name_snapshot, field_changed, previous_value, new_value, admin_id, admin_email)
    values (new.id, new.name, 'min_quantity', to_jsonb(old.min_quantity), to_jsonb(new.min_quantity), auth.uid(), public.current_admin_email());
  end if;
  if old.max_quantity is distinct from new.max_quantity then
    insert into public.rate_history(service_id, service_name_snapshot, field_changed, previous_value, new_value, admin_id, admin_email)
    values (new.id, new.name, 'max_quantity', to_jsonb(old.max_quantity), to_jsonb(new.max_quantity), auth.uid(), public.current_admin_email());
  end if;
  if old.estimated_time_text is distinct from new.estimated_time_text then
    insert into public.rate_history(service_id, service_name_snapshot, field_changed, previous_value, new_value, admin_id, admin_email)
    values (new.id, new.name, 'estimated_time_text', to_jsonb(old.estimated_time_text), to_jsonb(new.estimated_time_text), auth.uid(), public.current_admin_email());
  end if;
  if old.is_active is distinct from new.is_active then
    insert into public.rate_history(service_id, service_name_snapshot, field_changed, previous_value, new_value, admin_id, admin_email)
    values (new.id, new.name, 'is_active', to_jsonb(old.is_active), to_jsonb(new.is_active), auth.uid(), public.current_admin_email());
  end if;

  return new;
end;
$$;

create trigger trg_services_changes
  after insert or update or delete on public.services
  for each row execute function public.log_service_changes();

create or replace function public.log_tier_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_service_name text;
begin
  select name into v_service_name from public.services where id = coalesce(new.service_id, old.service_id);

  if tg_op = 'INSERT' then
    insert into public.rate_history(service_id, service_name_snapshot, field_changed, previous_value, new_value, admin_id, admin_email, reason)
    values (new.service_id, v_service_name, 'bulk_tier_added', null, to_jsonb(new), auth.uid(), public.current_admin_email(), nullif(current_setting('bhd.rate_reason', true), ''));
    perform public.write_audit_log('bulk_pricing_changed','service_price_tier', new.id::text, null, to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    insert into public.rate_history(service_id, service_name_snapshot, field_changed, previous_value, new_value, admin_id, admin_email, reason)
    values (new.service_id, v_service_name, 'bulk_tier_updated', to_jsonb(old), to_jsonb(new), auth.uid(), public.current_admin_email(), nullif(current_setting('bhd.rate_reason', true), ''));
    perform public.write_audit_log('bulk_pricing_changed','service_price_tier', new.id::text, to_jsonb(old), to_jsonb(new));
  elsif tg_op = 'DELETE' then
    insert into public.rate_history(service_id, service_name_snapshot, field_changed, previous_value, new_value, admin_id, admin_email, reason)
    values (old.service_id, v_service_name, 'bulk_tier_removed', to_jsonb(old), null, auth.uid(), public.current_admin_email(), nullif(current_setting('bhd.rate_reason', true), ''));
    perform public.write_audit_log('bulk_pricing_changed','service_price_tier', old.id::text, to_jsonb(old), null);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_tiers_changes
  after insert or update or delete on public.service_price_tiers
  for each row execute function public.log_tier_changes();

create or replace function public.log_offer_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit_log('offer_created','offer', new.id::text, null, to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    perform public.write_audit_log('offer_updated','offer', new.id::text, to_jsonb(old), to_jsonb(new));
  elsif tg_op = 'DELETE' then
    perform public.write_audit_log('offer_deleted','offer', old.id::text, to_jsonb(old), null);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_offers_audit
  after insert or update or delete on public.offers
  for each row execute function public.log_offer_audit();

create or replace function public.log_coupon_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit_log('coupon_created','coupon', new.id::text, null, to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    perform public.write_audit_log('coupon_updated','coupon', new.id::text, to_jsonb(old), to_jsonb(new));
  elsif tg_op = 'DELETE' then
    perform public.write_audit_log('coupon_deleted','coupon', old.id::text, to_jsonb(old), null);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_coupons_audit
  after insert or update or delete on public.coupons
  for each row execute function public.log_coupon_audit();

create or replace function public.log_payment_settings_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.write_audit_log('payment_settings_changed','payment_settings','main', to_jsonb(old), to_jsonb(new));
  return new;
end;
$$;

create trigger trg_payment_settings_audit
  after update on public.payment_settings
  for each row execute function public.log_payment_settings_audit();

create or replace function public.log_site_settings_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.write_audit_log('site_settings_changed','site_settings','main', to_jsonb(old), to_jsonb(new));
  return new;
end;
$$;

create trigger trg_site_settings_audit
  after update on public.site_settings
  for each row execute function public.log_site_settings_audit();

create or replace function public.log_payment_qr_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit_log('payment_qr_changed','payment_qr_code', new.id::text, null, to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    perform public.write_audit_log('payment_qr_changed','payment_qr_code', new.id::text, to_jsonb(old), to_jsonb(new));
  elsif tg_op = 'DELETE' then
    perform public.write_audit_log('payment_qr_changed','payment_qr_code', old.id::text, to_jsonb(old), null);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_payment_qr_codes_audit
  after insert or update or delete on public.payment_qr_codes
  for each row execute function public.log_payment_qr_audit();

create or replace function public.log_admin_users_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit_log('admin_permission_changed','admin_user', new.id::text, null, to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    perform public.write_audit_log('admin_permission_changed','admin_user', new.id::text, to_jsonb(old), to_jsonb(new));
  elsif tg_op = 'DELETE' then
    perform public.write_audit_log('admin_permission_changed','admin_user', old.id::text, to_jsonb(old), null);
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_admin_users_audit
  after insert or update or delete on public.admin_users
  for each row execute function public.log_admin_users_audit();

create or replace function public.log_order_status_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status is distinct from new.status then
    perform public.write_audit_log('order_status_changed','order', new.id::text,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;
  return new;
end;
$$;

create trigger trg_orders_status_audit
  after update on public.orders
  for each row execute function public.log_order_status_audit();

-- =====================================================================
-- SECTION 8: SECURE RPC FUNCTIONS (money-moving / order-placing logic)
-- =====================================================================

-- Customer creates a brand new fund request + first receipt.
create or replace function public.create_fund_request(p_amount numeric, p_receipt_path text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_request_id uuid;
  v_code text;
begin
  if v_user is null then
    raise exception 'You must be logged in.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Please enter a valid amount.';
  end if;
  if p_receipt_path is null or length(trim(p_receipt_path)) = 0 then
    raise exception 'Please upload your payment receipt.';
  end if;

  v_code := public.generate_code('FR');

  insert into public.fund_requests(request_code, user_id, amount, status, attempt_number)
  values (v_code, v_user, p_amount, 'pending', 1)
  returning id into v_request_id;

  insert into public.fund_request_receipts(fund_request_id, storage_path, attempt_number)
  values (v_request_id, p_receipt_path, 1);

  return json_build_object('id', v_request_id, 'request_code', v_code);
end;
$$;

grant execute on function public.create_fund_request(numeric, text) to authenticated;

-- Customer re-uploads a receipt after admin asked for "Re-upload Required".
create or replace function public.resubmit_fund_request(p_fund_request_id uuid, p_receipt_path text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_fr public.fund_requests%rowtype;
  v_new_attempt int;
begin
  select * into v_fr from public.fund_requests where id = p_fund_request_id for update;
  if v_fr is null then
    raise exception 'Fund request not found.';
  end if;
  if v_fr.user_id <> v_user then
    raise exception 'Not authorized.';
  end if;
  if v_fr.status <> 'reupload_required' then
    raise exception 'This request is not awaiting re-upload.';
  end if;
  if p_receipt_path is null or length(trim(p_receipt_path)) = 0 then
    raise exception 'Please upload your payment receipt.';
  end if;

  v_new_attempt := v_fr.attempt_number + 1;

  insert into public.fund_request_receipts(fund_request_id, storage_path, attempt_number)
  values (v_fr.id, p_receipt_path, v_new_attempt);

  update public.fund_requests
  set attempt_number = v_new_attempt, status = 'pending', admin_remark = null, updated_at = now()
  where id = v_fr.id;

  return json_build_object('id', v_fr.id, 'attempt_number', v_new_attempt);
end;
$$;

grant execute on function public.resubmit_fund_request(uuid, text) to authenticated;

-- Push-notifies a single customer (as opposed to notify_admins() below,
-- which pushes every admin). Uses the send-push Edge Function with
-- audience='user' so only that one person's device(s) get it. Wrapped in
-- its own exception handler so a push hiccup (bad key, function down,
-- pg_net not enabled) can NEVER block the real action (approving a fund
-- request, updating an order, replying to a ticket, etc.) from completing
-- and from writing its normal in-app notification row.
--
-- IMPORTANT: replace YOUR-SERVICE-ROLE-KEY below with the SAME
-- service_role key you already used for notify_admins() (Migration 007) -
-- Project Settings -> API -> Project API keys -> service_role. If you
-- never set that up, admin push notifications aren't live either yet;
-- this is safe to run regardless (it just won't deliver pushes until a
-- real key is in place - in-app notifications still work either way).
create or replace function public.notify_user(p_user_id uuid, p_title text, p_body text, p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://zmopoujgltbiegrarvkp.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR-SERVICE-ROLE-KEY'
    ),
    body := jsonb_build_object(
      'title', p_title,
      'body', p_body,
      'url', p_url,
      'audience', 'user',
      'userId', p_user_id
    )
  );
exception when others then
  null;
end;
$$;

-- Admin approves / rejects / requests re-upload. This is the ONLY way
-- a fund request status can ever change, and the ONLY way wallet credit
-- from a fund request can happen. Row is locked (for update) so two
-- admins clicking Approve at the same time cannot double-credit.
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

-- Fallback for the (rare) case where a customer's OWN receipt upload
-- keeps failing on their phone - they send the admin the payment
-- screenshot directly (e.g. over WhatsApp), and the admin records it
-- here on the customer's behalf. This creates a normal PENDING fund
-- request, identical in every way to one the customer submitted
-- themselves (same notification to every admin, same Fund Requests
-- queue, same admin_review_fund_request() approval step required before
-- any money moves) - it's just a second way to get a request INTO that
-- trusted queue, not a shortcut around reviewing/approving it.
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

  return json_build_object('id', v_request_id, 'request_code', v_code);
end;
$$;

grant execute on function public.admin_create_fund_request_for_customer(uuid, numeric, text, text) to authenticated;

-- Customer creates a refund request. They can only ever request
-- "wallet" as far as they're concerned - the amount is always exactly
-- what they actually paid for that order (after any coupon discount).
create or replace function public.create_refund_request(p_order_id uuid, p_reason text default null, p_customer_proof_path text default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_order public.orders%rowtype;
  v_amount numeric(12,2);
  v_ordered_qty int;
  v_code text;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'You must be logged in.';
  end if;

  select * into v_order from public.orders where id = p_order_id and user_id = v_user for update;
  if v_order is null then
    raise exception 'Order not found.';
  end if;
  if v_order.status not in ('processing','completed') then
    raise exception 'This order is not eligible for a refund request.';
  end if;
  if exists (select 1 from public.refund_requests where order_id = p_order_id and status = 'pending') then
    raise exception 'A refund request for this order is already pending.';
  end if;
  -- The proof photo, if any, must live in the customer's own storage
  -- folder (the refund-customer-proof bucket's own insert policy already
  -- enforces this at upload time, but we double-check here too).
  if p_customer_proof_path is not null and split_part(p_customer_proof_path, '/', 1) <> v_user::text then
    raise exception 'Invalid proof photo.';
  end if;

  v_amount := greatest(v_order.grand_total - coalesce(v_order.discount_amount, 0), 0);
  select coalesce(sum(quantity), 0) into v_ordered_qty from public.order_items where order_id = p_order_id;

  v_code := public.generate_code('RF');

  insert into public.refund_requests (request_code, order_id, user_id, amount, ordered_quantity, reason, customer_proof_path, status)
  values (v_code, p_order_id, v_user, v_amount, v_ordered_qty, nullif(trim(coalesce(p_reason, '')), ''), nullif(trim(coalesce(p_customer_proof_path, '')), ''), 'pending')
  returning id into v_id;

  return json_build_object('id', v_id, 'request_code', v_code, 'amount', v_amount);
end;
$$;

grant execute on function public.create_refund_request(uuid, text, text) to authenticated;

-- When an order that used a coupon is cancelled/refunded, that coupon
-- redemption is undone too - as far as usage limits are concerned, it's
-- as if that order never happened. Safe to call more than once for the
-- same order (does nothing if the redemption is already gone).
create or replace function public.release_coupon_redemption_for_order(p_order_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_redemption public.coupon_redemptions%rowtype;
begin
  select * into v_redemption from public.coupon_redemptions where order_id = p_order_id limit 1;
  if v_redemption.id is not null then
    delete from public.coupon_redemptions where id = v_redemption.id;
    update public.coupons set times_used = greatest(times_used - 1, 0) where id = v_redemption.coupon_id;
  end if;
end;
$$;

-- Admin approves (wallet or bank/UPI) or rejects a refund request.
-- Wallet approvals credit the wallet instantly. Bank/UPI approvals do
-- Wallet method credits the wallet for the actual amount (which the admin
-- can edit down from the customer's original ask - useful when a
-- GPay/PhonePe payout only partially went through). Bank/UPI method does
-- NOT change the spendable wallet balance - the admin has paid the
-- customer directly - but still writes a before=after ledger row so every
-- refund (wallet or bank) shows up together in Wallet Transactions for
-- record-keeping, with proof (receipt_path) as evidence.
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

      -- A refund reverses money that was previously counted as "used" when
      -- the order was placed - without this, total_fund_used stays
      -- permanently inflated by amounts the customer actually got back,
      -- making "Total Fund Used" misleading. Move it into
      -- total_fund_refunded instead so both numbers stay honest.
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
        -- Paid externally (not back into the wallet), but the original
        -- spend still came out of this wallet's total_fund_used at
        -- checkout, so it still needs to move into total_fund_refunded -
        -- available_fund itself is untouched.
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

-- Optional: push-notify admins on a new refund request (see Migration
-- 007 / notify_admins()). Safe even if that was never set up.
create or replace function public.trg_notify_admin_new_refund()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.notify_admins(
      'New Refund Request 💸',
      'Order refund requested — ₹' || to_char(new.amount, 'FM999999990') || ' (' || new.request_code || ').',
      '/admin/refunds'
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists trg_refund_requests_notify_admin on public.refund_requests;
create trigger trg_refund_requests_notify_admin
  after insert on public.refund_requests
  for each row execute function public.trg_notify_admin_new_refund();

-- Optional: push-notify admins the moment a customer submits a new fund
-- request (uploads a payment receipt to add money to their wallet), and
-- again when they re-upload a corrected receipt after "Re-upload
-- Required". Without this, a new fund request only showed up if an
-- admin happened to open the Fund Requests page and refresh it - it
-- never pushed to their phone the way new orders/refunds/support
-- messages already did. Safe even if notify_admins() was never set up.
create or replace function public.trg_notify_admin_new_fund_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.notify_admins(
      'New Fund Request 💰',
      'Payment receipt submitted — ₹' || to_char(new.amount, 'FM999999990') || ' (' || new.request_code || ').',
      '/admin/fund-requests'
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists trg_fund_requests_notify_admin on public.fund_requests;
create trigger trg_fund_requests_notify_admin
  after insert on public.fund_requests
  for each row execute function public.trg_notify_admin_new_fund_request();

create or replace function public.trg_notify_admin_fund_request_resubmit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pending' and old.status = 'reupload_required' then
    begin
      perform public.notify_admins(
        'Fund Request Re-uploaded 💰',
        'Corrected receipt submitted — ₹' || to_char(new.amount, 'FM999999990') || ' (' || new.request_code || ').',
        '/admin/fund-requests'
      );
    exception when others then
      null;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fund_requests_notify_admin_resubmit on public.fund_requests;
create trigger trg_fund_requests_notify_admin_resubmit
  after update on public.fund_requests
  for each row execute function public.trg_notify_admin_fund_request_resubmit();

-- Read-only coupon preview used by the checkout screen before the
-- customer pays. Records nothing; the real, final check happens again
-- inside place_order below so nothing can be bypassed from the browser.
create or replace function public.validate_coupon(p_code text, p_order_amount numeric)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_coupon public.coupons%rowtype;
  v_discount numeric;
begin
  if v_user is null then
    raise exception 'You must be logged in.';
  end if;
  if p_code is null or length(trim(p_code)) = 0 then
    raise exception 'Please enter a coupon code.';
  end if;

  select * into v_coupon from public.coupons where upper(code) = upper(trim(p_code));
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
  if p_order_amount < v_coupon.min_order_amount then
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
    v_discount := round(p_order_amount * v_coupon.discount_value / 100, 2);
    if v_coupon.max_discount_amount is not null and v_discount > v_coupon.max_discount_amount then
      v_discount := v_coupon.max_discount_amount;
    end if;
  else
    v_discount := v_coupon.discount_value;
  end if;
  if v_discount > p_order_amount then
    v_discount := p_order_amount;
  end if;

  return json_build_object(
    'valid', true,
    'code', v_coupon.code,
    'title', v_coupon.title,
    'discount_amount', v_discount,
    'payable_total', p_order_amount - v_discount
  );
end;
$$;

grant execute on function public.validate_coupon(text, numeric) to authenticated;

-- THE core secure checkout function. Recalculates everything server-side,
-- never trusts a price (or a coupon discount) sent from the browser.
-- p_items example: [{"service_id":"...", "quantity":1000, "target_link":"https://instagram.com/x"}]
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

-- Authorized admin manually adds / deducts / sets a customer's balance.
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
    -- "Set Balance To" used to change available_fund without touching
    -- total_fund_added/total_fund_used at all, so Total Added on the
    -- customer's page could silently drift away from reality every time
    -- it was used (e.g. add ₹50, set to ₹0, add ₹50 again = Total Added
    -- shows ₹100 even though the customer only ever really has ₹50).
    -- Now a "set" that raises the balance counts toward Total Added, and
    -- one that lowers it counts toward Total Used, exactly like the
    -- add/deduct actions already do - so the two stats stay honest no
    -- matter which action an admin uses.
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

-- Admin updates order status (Received / Processing / Completed / Cancelled / Refunded).
-- Moving an order to cancelled/refunded from here auto-refunds the
-- customer's wallet (this store takes payment manually, so "refund" just
-- means crediting their in-app wallet balance back - no payment gateway
-- involved). Guarded so it only fires once per order: skipped if the
-- order was already cancelled/refunded before, or if a refund transaction
-- already exists for it (e.g. approved separately via the Refunds page),
-- so status and wallet balance can never drift apart.
create or replace function public.admin_update_order_status(p_order_id uuid, p_status text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_order public.orders%rowtype;
  v_wallet public.wallets%rowtype;
  v_before numeric;
  v_after numeric;
  v_already_refunded boolean;
  v_paid_amount numeric;
begin
  if not public.has_permission('manage_orders') then
    raise exception 'Not authorized.';
  end if;
  if p_status not in ('received','processing','completed','cancelled','refunded') then
    raise exception 'Invalid status.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'Order not found.';
  end if;

  if p_status in ('cancelled','refunded') and v_order.status not in ('cancelled','refunded') then
    select exists(
      select 1 from public.wallet_transactions
      where related_order_id = p_order_id and type = 'refund'
    ) into v_already_refunded;

    if not v_already_refunded then
      -- Refund exactly what left the wallet at checkout (grand_total minus
      -- any coupon discount), never the pre-discount grand_total - that
      -- would hand the customer back the discount amount a second time.
      v_paid_amount := v_order.grand_total - coalesce(v_order.discount_amount, 0);

      select * into v_wallet from public.wallets where user_id = v_order.user_id for update;
      if v_wallet is not null and v_paid_amount > 0 then
        v_before := v_wallet.available_fund;
        v_after := v_before + v_paid_amount;

        -- Same accounting fix as admin_review_refund_request: move this
        -- amount out of total_fund_used and into total_fund_refunded so
        -- it doesn't sit there looking permanently "spent".
        update public.wallets
        set available_fund = v_after,
            total_fund_used = greatest(total_fund_used - v_paid_amount, 0),
            total_fund_refunded = total_fund_refunded + v_paid_amount,
            updated_at = now()
        where id = v_wallet.id;

        insert into public.wallet_transactions
          (wallet_id, user_id, type, amount, balance_before, balance_after, status, remark, related_order_id, created_by_admin_id)
        values
          (v_wallet.id, v_order.user_id, 'refund', v_paid_amount, v_before, v_after, 'completed',
           'Order ' || v_order.order_code || ' was cancelled - amount refunded to wallet.', p_order_id, v_admin);

        insert into public.notifications (user_id, title, message, type, related_id)
        values (
          v_order.user_id,
          'Order Cancelled - Refunded',
          'Your order ' || v_order.order_code || ' was cancelled and ' || to_char(v_paid_amount, 'FM999999990.00') ||
            ' has been refunded to your wallet.',
          'order',
          p_order_id
        );
        perform public.notify_user(v_order.user_id, 'Order Cancelled - Refunded',
          'Your order ' || v_order.order_code || ' was cancelled and ₹' || to_char(v_paid_amount, 'FM999999990.00') ||
            ' has been refunded to your wallet.', '/orders');

        perform public.write_audit_log('order_cancelled_auto_refund', 'order', p_order_id::text,
          jsonb_build_object('status', v_order.status),
          jsonb_build_object('status', p_status, 'refund_amount', v_paid_amount),
          'Order cancelled from Orders page - wallet auto-refunded.');
      end if;

      perform public.release_coupon_redemption_for_order(p_order_id);
    end if;
  end if;

  -- Let the customer know their order moved forward, even when no money
  -- changed hands. Before this, only cancelled/refunded ever notified the
  -- customer - moving an order to "processing" or "completed" (the two
  -- most common admin actions) updated the database silently, and the
  -- customer would only find out by opening Order History themselves.
  if p_status = 'processing' then
    insert into public.notifications(user_id, title, message, type, related_id)
    values (v_order.user_id, 'Order In Progress', 'Your order ' || v_order.order_code || ' is now being processed.', 'order', p_order_id);
    perform public.notify_user(v_order.user_id, 'Order In Progress', 'Your order ' || v_order.order_code || ' is now being processed.', '/orders');
  elsif p_status = 'completed' then
    insert into public.notifications(user_id, title, message, type, related_id)
    values (v_order.user_id, 'Order Completed 🎉', 'Your order ' || v_order.order_code || ' has been completed. Thank you!', 'order', p_order_id);
    perform public.notify_user(v_order.user_id, 'Order Completed 🎉', 'Your order ' || v_order.order_code || ' has been completed. Thank you!', '/orders');
  elsif p_status in ('cancelled','refunded') and v_already_refunded then
    -- Refunded separately via the Refunds page already, so the detailed
    -- refund notification already went out there - just confirm the order
    -- itself is now marked this way too.
    insert into public.notifications(user_id, title, message, type, related_id)
    values (v_order.user_id, 'Order ' || initcap(p_status), 'Your order ' || v_order.order_code || ' has been marked as ' || p_status || '.', 'order', p_order_id);
    perform public.notify_user(v_order.user_id, 'Order ' || initcap(p_status), 'Your order ' || v_order.order_code || ' has been marked as ' || p_status || '.', '/orders');
  end if;

  update public.orders set status = p_status, updated_at = now() where id = p_order_id;

  return json_build_object('status','ok');
end;
$$;

grant execute on function public.admin_update_order_status(uuid, text) to authenticated;

-- Customer creates a new support ticket + its first message. Any
-- order/wallet-transaction/fund-request the customer selected is
-- verified to actually belong to them, server-side.
create or replace function public.create_support_ticket(
  p_category text,
  p_subject text,
  p_message text,
  p_sub_category text default null,
  p_order_id uuid default null,
  p_wallet_transaction_id uuid default null,
  p_fund_request_id uuid default null,
  p_transaction_ref text default null,
  p_payment_date date default null,
  p_amount numeric default null,
  p_failure_message text default null,
  p_occurred_location text default null,
  p_attachment_url text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_ticket_id uuid;
  v_code text;
begin
  if v_user is null then
    raise exception 'You must be logged in.';
  end if;
  if p_category not in ('technical','payment','order','wallet','dropped','failed_transaction','receipt','other') then
    raise exception 'Invalid issue category.';
  end if;
  if p_subject is null or length(trim(p_subject)) = 0 then
    raise exception 'A subject is required.';
  end if;
  if p_message is null or length(trim(p_message)) = 0 then
    raise exception 'Please describe the issue.';
  end if;

  if p_order_id is not null and not exists (select 1 from public.orders where id = p_order_id and user_id = v_user) then
    raise exception 'That order was not found on your account.';
  end if;
  if p_wallet_transaction_id is not null and not exists (select 1 from public.wallet_transactions where id = p_wallet_transaction_id and user_id = v_user) then
    raise exception 'That wallet transaction was not found on your account.';
  end if;
  if p_fund_request_id is not null and not exists (select 1 from public.fund_requests where id = p_fund_request_id and user_id = v_user) then
    raise exception 'That fund request was not found on your account.';
  end if;

  v_code := public.generate_code('TK');

  insert into public.support_tickets (
    ticket_code, user_id, category, sub_category, subject,
    order_id, wallet_transaction_id, fund_request_id,
    transaction_ref, payment_date, amount, failure_message, occurred_location,
    has_unread_customer_message
  ) values (
    v_code, v_user, p_category, nullif(trim(coalesce(p_sub_category, '')), ''), trim(p_subject),
    p_order_id, p_wallet_transaction_id, p_fund_request_id,
    nullif(trim(coalesce(p_transaction_ref, '')), ''), p_payment_date, p_amount,
    nullif(trim(coalesce(p_failure_message, '')), ''), nullif(trim(coalesce(p_occurred_location, '')), ''),
    true
  ) returning id into v_ticket_id;

  insert into public.support_messages (ticket_id, sender_type, sender_id, message, attachment_url, is_read)
  values (v_ticket_id, 'customer', v_user, trim(p_message), p_attachment_url, false);

  return json_build_object('id', v_ticket_id, 'ticket_code', v_code);
end;
$$;

grant execute on function public.create_support_ticket(text, text, text, text, uuid, uuid, uuid, text, date, numeric, text, text, text) to authenticated;

-- Either the ticket owner (customer) or an admin with manage_support can
-- post into the conversation. Admin replies create an in-app notification
-- automatically (the email is sent separately by the frontend calling the
-- send-support-email Edge Function right after this succeeds).
create or replace function public.send_support_reply(
  p_ticket_id uuid,
  p_message text,
  p_attachment_url text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_ticket public.support_tickets%rowtype;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'You must be logged in.';
  end if;
  if p_message is null or length(trim(p_message)) = 0 then
    raise exception 'Message cannot be empty.';
  end if;

  select * into v_ticket from public.support_tickets where id = p_ticket_id;
  if not found then
    raise exception 'Ticket not found.';
  end if;

  if v_ticket.user_id = v_uid then
    insert into public.support_messages (ticket_id, sender_type, sender_id, message, attachment_url, is_read)
    values (p_ticket_id, 'customer', v_uid, trim(p_message), p_attachment_url, false);

    update public.support_tickets
    set last_message_at = now(),
        has_unread_customer_message = true,
        status = case when status = 'waiting_customer' then 'open' else status end
    where id = p_ticket_id;

    return json_build_object('status', 'ok', 'as', 'customer');

  elsif public.has_permission('manage_support') then
    insert into public.support_messages (ticket_id, sender_type, sender_id, message, attachment_url, is_read)
    values (p_ticket_id, 'admin', v_uid, trim(p_message), p_attachment_url, false);

    update public.support_tickets
    set last_message_at = now(),
        has_unread_admin_reply = true
    where id = p_ticket_id;

    insert into public.notifications (user_id, title, message, type, related_id)
    values (
      v_ticket.user_id,
      'New Support Reply',
      'You have received a new reply from Support on ticket ' || v_ticket.ticket_code || '.',
      'support_reply',
      p_ticket_id
    );
    perform public.notify_user(
      v_ticket.user_id,
      'New Support Reply 💬',
      'You have received a new reply from Support on ticket ' || v_ticket.ticket_code || '.',
      '/support/' || p_ticket_id::text
    );

    return json_build_object('status', 'ok', 'as', 'admin');

  else
    raise exception 'Not authorized.';
  end if;
end;
$$;

grant execute on function public.send_support_reply(uuid, text, text) to authenticated;

-- Admin-only status change.
create or replace function public.admin_update_ticket_status(p_ticket_id uuid, p_status text)
returns json
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('manage_support') then
    raise exception 'Not authorized.';
  end if;
  if p_status not in ('open','in_progress','waiting_customer','resolved','closed') then
    raise exception 'Invalid status.';
  end if;
  update public.support_tickets set status = p_status where id = p_ticket_id;
  if not found then
    raise exception 'Ticket not found.';
  end if;
  return json_build_object('status', 'ok');
end;
$$;

grant execute on function public.admin_update_ticket_status(uuid, text) to authenticated;

-- Called when either side OPENS a ticket: marks the other side's
-- messages as read, clears the relevant unread flag, and marks any
-- matching notification as read (so the bell badge count updates).
create or replace function public.mark_ticket_read(p_ticket_id uuid)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_ticket public.support_tickets%rowtype;
  v_uid uuid := auth.uid();
begin
  select * into v_ticket from public.support_tickets where id = p_ticket_id;
  if not found then
    raise exception 'Ticket not found.';
  end if;

  if v_ticket.user_id = v_uid then
    update public.support_messages set is_read = true where ticket_id = p_ticket_id and sender_type = 'admin' and is_read = false;
    -- The "and has_unread_admin_reply = true" guard matters: without it,
    -- this UPDATE runs (and broadcasts a realtime change event) every
    -- single time this function is called, even when there was nothing
    -- to clear. The customer's ticket screen re-loads on any realtime
    -- change to this row and calls this function again on load - so an
    -- unguarded UPDATE here used to create an infinite loop of reads/
    -- writes for as long as that screen stayed open.
    update public.support_tickets set has_unread_admin_reply = false where id = p_ticket_id and has_unread_admin_reply = true;
    update public.notifications set is_read = true where related_id = p_ticket_id and user_id = v_uid and is_read = false;
    return json_build_object('status', 'ok');

  elsif public.has_permission('manage_support') then
    update public.support_messages set is_read = true where ticket_id = p_ticket_id and sender_type = 'customer' and is_read = false;
    update public.support_tickets set has_unread_customer_message = false where id = p_ticket_id and has_unread_customer_message = true;
    return json_build_object('status', 'ok');

  else
    raise exception 'Not authorized.';
  end if;
end;
$$;

grant execute on function public.mark_ticket_read(uuid) to authenticated;

-- Saves (or refreshes) a browser's Web Push subscription. Works for both
-- signed-in customers (linked to their account) and anonymous visitors
-- (user_id left null) - anyone browsing can opt into offer notifications.
-- No direct table INSERT/UPDATE policy exists on push_subscriptions - this
-- SECURITY DEFINER function is the only way in, same pattern as wallets.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns json
language plpgsql security definer set search_path = public as $$
begin
  if p_endpoint is null or p_p256dh is null or p_auth is null then
    raise exception 'Invalid subscription.';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update
    set user_id = coalesce(auth.uid(), public.push_subscriptions.user_id),
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        last_seen_at = now();

  return json_build_object('status', 'ok');
end;
$$;

grant execute on function public.save_push_subscription(text, text, text, text) to anon, authenticated;

-- Removes a subscription (e.g. user disables notifications in their browser).
create or replace function public.remove_push_subscription(p_endpoint text)
returns json
language plpgsql security definer set search_path = public as $$
begin
  delete from public.push_subscriptions
  where endpoint = p_endpoint and (user_id is null or user_id = auth.uid());
  return json_build_object('status', 'ok');
end;
$$;

grant execute on function public.remove_push_subscription(text) to anon, authenticated;

-- Admin updates a service's live rate, with an optional reason that is
-- attached to the resulting rate_history row (see trigger above).
create or replace function public.admin_update_service_rate(p_service_id uuid, p_new_rate numeric, p_reason text default null)
returns json
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('manage_rates') then
    raise exception 'Not authorized.';
  end if;
  if p_new_rate is null or p_new_rate < 0 then
    raise exception 'Rate must be zero or greater.';
  end if;

  perform set_config('bhd.rate_reason', coalesce(p_reason, ''), true);

  update public.services set base_rate = p_new_rate where id = p_service_id;
  if not found then
    raise exception 'Service not found.';
  end if;

  return json_build_object('status', 'ok');
end;
$$;

grant execute on function public.admin_update_service_rate(uuid, numeric, text) to authenticated;

-- Admin creates/updates a bulk pricing tier, with an optional reason
-- attached to the resulting rate_history row (see trigger above).
create or replace function public.admin_upsert_price_tier(
  p_tier_id uuid, p_service_id uuid, p_min_quantity int, p_max_quantity int,
  p_rate numeric, p_is_active boolean, p_display_order int, p_reason text default null
)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.has_permission('manage_bulk_pricing') then
    raise exception 'Not authorized.';
  end if;
  if p_min_quantity is null or p_min_quantity <= 0 then
    raise exception 'Minimum quantity must be greater than zero.';
  end if;
  if p_max_quantity is not null and p_max_quantity < p_min_quantity then
    raise exception 'Maximum quantity must be greater than or equal to minimum quantity.';
  end if;
  if p_rate is null or p_rate < 0 then
    raise exception 'Rate must be zero or greater.';
  end if;

  perform set_config('bhd.rate_reason', coalesce(p_reason, ''), true);

  if p_tier_id is null then
    insert into public.service_price_tiers(service_id, min_quantity, max_quantity, rate, is_active, display_order)
    values (p_service_id, p_min_quantity, p_max_quantity, p_rate, p_is_active, p_display_order)
    returning id into v_id;
  else
    update public.service_price_tiers
    set min_quantity = p_min_quantity, max_quantity = p_max_quantity, rate = p_rate, is_active = p_is_active, display_order = p_display_order
    where id = p_tier_id
    returning id into v_id;
  end if;

  return json_build_object('id', v_id);
end;
$$;

grant execute on function public.admin_upsert_price_tier(uuid, uuid, int, int, numeric, boolean, int, text) to authenticated;

-- =====================================================================
-- SECTION 9: ROW LEVEL SECURITY
-- =====================================================================

alter table public.profiles enable row level security;
alter table public.admin_users enable row level security;
alter table public.categories enable row level security;
alter table public.services enable row level security;
alter table public.service_price_tiers enable row level security;
alter table public.rate_history enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.fund_requests enable row level security;
alter table public.fund_request_receipts enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.offers enable row level security;
alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.notifications enable row level security;
alter table public.payment_settings enable row level security;
alter table public.site_settings enable row level security;
alter table public.payment_qr_codes enable row level security;
alter table public.audit_logs enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.refund_requests enable row level security;

-- ---------------- profiles ----------------
create policy "profiles_select" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

create policy "profiles_update" on public.profiles
  for update using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- ---------------- admin_users ----------------
create policy "admin_users_select" on public.admin_users
  for select using (id = auth.uid() or public.has_permission('manage_admins'));

create policy "admin_users_insert" on public.admin_users
  for insert with check (public.has_permission('manage_admins'));

create policy "admin_users_update" on public.admin_users
  for update using (public.has_permission('manage_admins')) with check (public.has_permission('manage_admins'));

create policy "admin_users_delete" on public.admin_users
  for delete using (public.has_permission('manage_admins'));

-- ---------------- categories ----------------
create policy "categories_select" on public.categories
  for select using (is_active = true or public.is_admin());

create policy "categories_insert" on public.categories
  for insert with check (public.has_permission('manage_categories'));

create policy "categories_update" on public.categories
  for update using (public.has_permission('manage_categories')) with check (public.has_permission('manage_categories'));

create policy "categories_delete" on public.categories
  for delete using (public.has_permission('manage_categories'));

-- ---------------- services ----------------
create policy "services_select" on public.services
  for select using (
    (is_active = true and exists (select 1 from public.categories c where c.id = category_id and c.is_active = true))
    or public.is_admin()
  );

create policy "services_insert" on public.services
  for insert with check (public.has_permission('manage_services'));

create policy "services_update" on public.services
  for update using (public.has_permission('manage_services')) with check (public.has_permission('manage_services'));

create policy "services_delete" on public.services
  for delete using (public.has_permission('manage_services'));

-- ---------------- service_price_tiers ----------------
create policy "tiers_select" on public.service_price_tiers
  for select using (is_active = true or public.is_admin());

create policy "tiers_insert" on public.service_price_tiers
  for insert with check (public.has_permission('manage_bulk_pricing'));

create policy "tiers_update" on public.service_price_tiers
  for update using (public.has_permission('manage_bulk_pricing')) with check (public.has_permission('manage_bulk_pricing'));

create policy "tiers_delete" on public.service_price_tiers
  for delete using (public.has_permission('manage_bulk_pricing'));

-- ---------------- rate_history (read-only to admins, written only by triggers) ----------------
-- Only roles that can actually change a rate/tier (super_admin, admin,
-- or a staff member... except staff can NEVER hold manage_rates or
-- manage_bulk_pricing - both are permanently restricted - so in
-- practice this is admin/super_admin only) can read the pricing change
-- history. A plain staff account has no legitimate reason to see past
-- rate changes/reasons, even though it was previously readable by any
-- admin_users row.
create policy "rate_history_select" on public.rate_history
  for select using (public.has_permission('manage_rates') or public.has_permission('manage_bulk_pricing'));

-- ---------------- wallets (no direct writes from the client at all) ----------------
create policy "wallets_select" on public.wallets
  for select using (user_id = auth.uid() or public.is_admin());

-- ---------------- wallet_transactions (read-only; all writes via RPC) ----------------
create policy "wallet_tx_select" on public.wallet_transactions
  for select using (user_id = auth.uid() or public.is_admin());

-- ---------------- fund_requests (read-only from client; writes via RPC) ----------------
create policy "fund_requests_select" on public.fund_requests
  for select using (user_id = auth.uid() or public.is_admin());

-- ---------------- fund_request_receipts ----------------
create policy "fund_receipts_select" on public.fund_request_receipts
  for select using (
    exists (select 1 from public.fund_requests fr where fr.id = fund_request_id and (fr.user_id = auth.uid() or public.is_admin()))
  );

-- ---------------- orders ----------------
create policy "orders_select" on public.orders
  for select using (user_id = auth.uid() or public.is_admin());

create policy "orders_update_admin" on public.orders
  for update using (public.has_permission('manage_orders')) with check (public.has_permission('manage_orders'));

-- ---------------- order_items ----------------
create policy "order_items_select" on public.order_items
  for select using (
    exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_admin()))
  );

-- ---------------- offers ----------------
create policy "offers_select" on public.offers
  for select using (
    (is_active = true and (valid_from is null or valid_from <= current_date) and (valid_until is null or valid_until >= current_date))
    or public.is_admin()
  );

create policy "offers_insert" on public.offers
  for insert with check (public.has_permission('manage_offers'));

create policy "offers_update" on public.offers
  for update using (public.has_permission('manage_offers')) with check (public.has_permission('manage_offers'));

create policy "offers_delete" on public.offers
  for delete using (public.has_permission('manage_offers'));

-- ---------------- coupons / coupon_redemptions ----------------
create policy "coupons_select" on public.coupons
  for select using (
    (is_active = true and (valid_from is null or valid_from <= current_date) and (valid_until is null or valid_until >= current_date))
    or public.is_admin()
  );

create policy "coupons_insert" on public.coupons
  for insert with check (public.has_permission('manage_coupons'));

create policy "coupons_update" on public.coupons
  for update using (public.has_permission('manage_coupons')) with check (public.has_permission('manage_coupons'));

create policy "coupons_delete" on public.coupons
  for delete using (public.has_permission('manage_coupons'));

-- No direct INSERT/UPDATE policies on coupon_redemptions - every row is
-- written by the place_order RPC only.
create policy "coupon_redemptions_select" on public.coupon_redemptions
  for select using (user_id = auth.uid() or public.is_admin());

-- ---------------- support_tickets / support_messages ----------------
-- No direct INSERT/UPDATE policies on purpose - every write goes through
-- a SECURITY DEFINER RPC (create_support_ticket / send_support_reply /
-- admin_update_ticket_status / mark_ticket_read) so ownership and
-- permission are always checked on the server.
create policy "support_tickets_select" on public.support_tickets
  for select using (user_id = auth.uid() or public.is_admin());

create policy "support_select" on public.support_messages
  for select using (
    exists (
      select 1 from public.support_tickets t
      where t.id = support_messages.ticket_id
        and (t.user_id = auth.uid() or public.is_admin())
    )
  );

-- ---------------- notifications ----------------
create policy "notifications_select" on public.notifications
  for select using (user_id = auth.uid());

create policy "notifications_update" on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------- payment_settings ----------------
create policy "payment_settings_select" on public.payment_settings
  for select using (auth.role() = 'authenticated' or public.is_admin());

create policy "payment_settings_update" on public.payment_settings
  for update using (public.has_permission('manage_payment_settings')) with check (public.has_permission('manage_payment_settings'));

-- ---------------- site_settings ----------------
-- select is open to EVERYONE (including anonymous/logged-out visitors) on
-- purpose, so the maintenance banner can be checked before login.
create policy "site_settings_select" on public.site_settings
  for select using (true);

create policy "site_settings_update" on public.site_settings
  for update using (public.has_permission('manage_payment_settings')) with check (public.has_permission('manage_payment_settings'));

-- ---------------- payment_qr_codes ----------------
create policy "payment_qr_codes_select" on public.payment_qr_codes
  for select using (auth.role() = 'authenticated' or public.is_admin());

create policy "payment_qr_codes_insert" on public.payment_qr_codes
  for insert with check (public.has_permission('manage_payment_settings'));

create policy "payment_qr_codes_update" on public.payment_qr_codes
  for update using (public.has_permission('manage_payment_settings')) with check (public.has_permission('manage_payment_settings'));

create policy "payment_qr_codes_delete" on public.payment_qr_codes
  for delete using (public.has_permission('manage_payment_settings'));

-- ---------------- audit_logs (read-only, admin/staff-with-permission only) ----------------
create policy "audit_logs_select" on public.audit_logs
  for select using (public.has_permission('view_audit_log'));

-- ---------------- push_subscriptions (no direct client writes - RPC only) ----------------
create policy "push_subscriptions_select" on public.push_subscriptions
  for select using (user_id = auth.uid() or public.is_admin());

-- ---------------- refund_requests (no direct client writes - RPC only) ----------------
-- Refunds are money-moving and manage_refunds is permanently restricted
-- from staff (see has_permission() above), so reading every customer's
-- refund requests (reasons, proof photos, sometimes bank/UPI details
-- typed into the reason field) is admin/super_admin only too - a plain
-- staff account gets no rows here beyond their own (they're customers
-- of nothing, so effectively zero).
create policy "refund_requests_select" on public.refund_requests
  for select using (user_id = auth.uid() or public.has_permission('manage_refunds'));

-- =====================================================================
-- SECTION 10: SEED DATA (payment settings singleton row)
-- =====================================================================

insert into public.payment_settings (id) values (true) on conflict (id) do nothing;
insert into public.site_settings (id) values (true) on conflict (id) do nothing;

-- =====================================================================
-- SECTION 11: STORAGE CLEANUP (Super Admin / Admin only - "manage_storage"
-- is in has_permission()'s restricted list above, so staff never get it)
-- =====================================================================
-- The "receipts" bucket (fund-add payment proof) is permanently
-- protected and never appears here - see storage.sql: "receipts must
-- never be edited or removed, preserving full re-upload history".

-- Per-bucket usage: how many files and how many bytes each bucket holds.
create or replace function public.storage_usage_summary()
returns table(bucket_id text, file_count bigint, total_bytes bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('manage_storage') then
    raise exception 'Not authorized.';
  end if;
  return query
    select o.bucket_id::text, count(*)::bigint, coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
    from storage.objects o
    group by o.bucket_id
    order by 3 desc;
end;
$$;

-- Old/replaced payment-QR images. PaymentSettings.jsx uploads every new
-- QR under a brand new filename (never overwrites), so anything not
-- currently referenced by payment_qr_codes.qr_image_path is a leftover
-- nobody uses any more - always 100% safe to delete.
create or replace function public.storage_qr_orphans()
returns table(name text, created_at timestamptz, size_bytes bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('manage_storage') then
    raise exception 'Not authorized.';
  end if;
  return query
    select o.name::text, o.created_at::timestamptz, coalesce((o.metadata->>'size')::bigint, 0)::bigint
    from storage.objects o
    where o.bucket_id = 'payment-qr'
      and o.name not in (select qr_image_path from public.payment_qr_codes where qr_image_path is not null)
    order by o.created_at asc;
end;
$$;

create or replace function public.storage_delete_qr_orphans()
returns table(deleted_count int, freed_bytes bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_bytes bigint;
begin
  if not public.has_permission('manage_storage') then
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

-- Browse files in one of the reviewable buckets (everything except
-- "receipts") so an admin can pick exactly what to remove by hand -
-- these images are still linked from old support tickets / refund
-- records, so deleting one means that old record's photo can no longer
-- be viewed. Optionally only files uploaded before a given date.
create or replace function public.storage_list_files(p_bucket text, p_before timestamptz default null)
returns table(name text, created_at timestamptz, size_bytes bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('manage_storage') then
    raise exception 'Not authorized.';
  end if;
  if p_bucket = 'receipts' then
    raise exception 'Payment receipts are protected and cannot be browsed for deletion here.';
  end if;
  if p_bucket not in ('support-attachments','refund-receipts','refund-customer-proof','payment-qr') then
    raise exception 'Unknown bucket.';
  end if;
  return query
    select o.name::text, o.created_at::timestamptz, coalesce((o.metadata->>'size')::bigint, 0)::bigint
    from storage.objects o
    where o.bucket_id = p_bucket
      and (p_before is null or o.created_at < p_before)
    order by o.created_at asc;
end;
$$;

-- Delete specific files an admin picked out by hand in the Storage
-- Cleanup page.
create or replace function public.storage_delete_files(p_bucket text, p_names text[])
returns table(deleted_count int, freed_bytes bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_bytes bigint;
begin
  if not public.has_permission('manage_storage') then
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

grant execute on function public.storage_usage_summary() to authenticated;
grant execute on function public.storage_qr_orphans() to authenticated;
grant execute on function public.storage_delete_qr_orphans() to authenticated;
grant execute on function public.storage_list_files(text, timestamptz) to authenticated;
grant execute on function public.storage_delete_files(text, text[]) to authenticated;

-- =====================================================================
-- END OF SCHEMA. Next: run supabase/storage.sql, then supabase/seed_admin.sql
-- =====================================================================
