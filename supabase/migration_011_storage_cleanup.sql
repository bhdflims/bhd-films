-- =====================================================================
-- BHD FILMS — MIGRATION 011: Storage cleanup tools for Super Admin/Admin
-- =====================================================================
-- Adds a new "manage_storage" permission (super_admin + admin only,
-- NEVER staff — same protected family as wallets/rates/refunds) and 5
-- functions the new "Storage Cleanup" admin page uses:
--
--   storage_usage_summary()            - how much space each bucket uses
--   storage_qr_orphans()               - old QR images nobody uses any more
--   storage_delete_qr_orphans()        - deletes those (100% safe)
--   storage_list_files(bucket, before) - browse a bucket so an admin can
--                                        pick exactly what to remove
--   storage_delete_files(bucket, names)- deletes the files picked
--
-- The "receipts" bucket (Add Funds payment proof) is permanently
-- protected and can never be deleted through any of these — same as
-- before this migration (see storage.sql: "receipts must never be
-- edited or removed, preserving full re-upload history").
-- Safe to run more than once.
-- =====================================================================

-- 1. Add manage_storage to the permanently-restricted set (staff never
--    get it, no matter what their permissions checkbox says).
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

-- 2. Per-bucket usage: how many files and how many bytes each holds.
create or replace function public.storage_usage_summary()
returns table(bucket_id text, file_count bigint, total_bytes bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('manage_storage') then
    raise exception 'Not authorized.';
  end if;
  return query
    select o.bucket_id, count(*), coalesce(sum((o.metadata->>'size')::bigint), 0)
    from storage.objects o
    group by o.bucket_id
    order by 3 desc;
end;
$$;

-- 3. Old/replaced payment-QR images. PaymentSettings.jsx uploads every
--    new QR under a brand new filename (never overwrites), so anything
--    not currently referenced by payment_qr_codes.qr_image_path is a
--    leftover nobody uses any more — always 100% safe to delete.
create or replace function public.storage_qr_orphans()
returns table(name text, created_at timestamptz, size_bytes bigint)
language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('manage_storage') then
    raise exception 'Not authorized.';
  end if;
  return query
    select o.name, o.created_at, coalesce((o.metadata->>'size')::bigint, 0)
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

-- 4. Browse files in one of the reviewable buckets (everything except
--    "receipts") so an admin can pick exactly what to remove by hand —
--    these images are still linked from old support tickets/refund
--    records, so deleting one means that old record's photo can no
--    longer be viewed. Optionally only files uploaded before a date.
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
    select o.name, o.created_at, coalesce((o.metadata->>'size')::bigint, 0)
    from storage.objects o
    where o.bucket_id = p_bucket
      and (p_before is null or o.created_at < p_before)
    order by o.created_at asc;
end;
$$;

-- 5. Delete specific files an admin picked out by hand.
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

-- Done! Refresh the admin panel — "Storage Cleanup" will now appear in
-- the sidebar for Super Admin and Admin accounts (never Staff).
