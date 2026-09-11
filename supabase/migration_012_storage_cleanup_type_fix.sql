-- =====================================================================
-- BHD FILMS — MIGRATION 012: Fix "structure of query does not match
-- function result type" error on the Storage Cleanup page
-- =====================================================================
-- The 3 read-only storage functions from migration_011 were selecting
-- columns straight off storage.objects without an explicit cast, which
-- Postgres can reject as not being an EXACT type match to the
-- function's declared RETURNS TABLE columns. This adds an explicit
-- ::text / ::timestamptz / ::bigint cast to every returned column so
-- there's no ambiguity. The delete functions were never affected (they
-- already returned local variables of the exact right type) and are
-- untouched here.
-- Safe to run more than once.
-- =====================================================================

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
