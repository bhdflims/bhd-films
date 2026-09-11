-- =====================================================================
-- BHD FILMS — MIGRATION 019: Brand Details (About Us / Terms / support
-- contact / header name / home tagline), editable by Super Admin only
-- =====================================================================
-- Adds a new brand_settings table holding the handful of customer-facing
-- text bits that used to be hardcoded in the app's code (so changing them
-- meant editing a file and pushing a new deploy):
--   - About Us page text
--   - Terms & Conditions text
--   - Support email / phone (shown to customers)
--   - The "BHD" / "FILMS" header name
--   - The "Let's Go Viral!" home page tagline
--
-- Every field can be left blank - the app falls back to its original
-- built-in text for anything not filled in, so this is 100% safe to run
-- and nothing on the live site changes until an admin actually edits
-- something on the new Brand Details page.
--
-- Only super_admin can change any of it (view is public, same as the
-- rest of the app's content) - matches the same restriction already
-- applied to wallet/storage/QR deletes in migration_018.
--
-- Safe to run more than once.
-- =====================================================================

create table if not exists public.brand_settings (
  id boolean primary key default true check (id),
  brand_name_primary text,
  brand_name_accent text,
  home_tagline text,
  support_email text,
  support_phone text,
  about_content text,
  terms_content text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.brand_settings (id) values (true) on conflict (id) do nothing;

alter table public.brand_settings enable row level security;

drop policy if exists "brand_settings_select" on public.brand_settings;
create policy "brand_settings_select" on public.brand_settings
  for select using (true);

drop policy if exists "brand_settings_update" on public.brand_settings;
create policy "brand_settings_update" on public.brand_settings
  for update using (public.is_super_admin()) with check (public.is_super_admin());

drop trigger if exists trg_brand_settings_updated on public.brand_settings;
create trigger trg_brand_settings_updated before update on public.brand_settings for each row execute function public.set_updated_at();

create or replace function public.log_brand_settings_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.write_audit_log('brand_settings_changed','brand_settings','main', to_jsonb(old), to_jsonb(new));
  return new;
end;
$$;

drop trigger if exists trg_brand_settings_audit on public.brand_settings;
create trigger trg_brand_settings_audit
  after update on public.brand_settings
  for each row execute function public.log_brand_settings_audit();
