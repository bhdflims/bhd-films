-- =====================================================================
-- BHD FILMS — MIGRATION 017: fix Storage Cleanup's delete buttons not
-- actually freeing space
-- =====================================================================
-- The Storage Cleanup page's two "delete" RPCs (storage_delete_qr_orphans
-- and storage_delete_files, see schema.sql) deleted files by running a
-- raw SQL "delete from storage.objects" - that only removes the catalog
-- row Supabase keeps track of each file in. It does NOT tell Supabase's
-- actual storage backend to remove the real file bytes, so the file
-- stayed in the bucket forever, still counted against your storage
-- quota, even though the Cleanup page said "Deleted" and the file
-- disappeared from its own file list.
--
-- The app code has been changed (this same update) to delete files the
-- correct way instead - through Supabase's real Storage API
-- (supabase.storage.from(bucket).remove(...)), which removes both the
-- actual file AND its catalog row together. That path is only allowed
-- for buckets/actions an RLS policy explicitly permits, so this adds
-- the missing "an admin with Manage Storage permission can delete from
-- this bucket" policies for the three buckets the Cleanup page lets an
-- admin pick files from, plus a second delete policy for payment-qr
-- (its existing delete policy is tied to a different permission -
-- Manage Payment Settings - used for the *live* QR code, not cleanup;
-- RLS policies for the same command are OR'd together, so this adds a
-- second, separate way in rather than replacing anything).
--
-- The "receipts" bucket (payment proof) still has NO delete policy at
-- all, on purpose - those must never be removable, from here or
-- anywhere else in the app.
--
-- Safe to run more than once.
-- =====================================================================

drop policy if exists "payment_qr_delete_storage_cleanup" on storage.objects;
create policy "payment_qr_delete_storage_cleanup"
on storage.objects for delete to authenticated
using (bucket_id = 'payment-qr' and public.has_permission('manage_storage'));

drop policy if exists "support_attachments_delete_admin" on storage.objects;
create policy "support_attachments_delete_admin"
on storage.objects for delete to authenticated
using (
  bucket_id = 'support-attachments'
  and public.has_permission('manage_storage')
);

drop policy if exists "refund_receipts_delete_admin" on storage.objects;
create policy "refund_receipts_delete_admin"
on storage.objects for delete to authenticated
using (
  bucket_id = 'refund-receipts'
  and public.has_permission('manage_storage')
);

drop policy if exists "refund_customer_proof_delete_admin" on storage.objects;
create policy "refund_customer_proof_delete_admin"
on storage.objects for delete to authenticated
using (
  bucket_id = 'refund-customer-proof'
  and public.has_permission('manage_storage')
);
