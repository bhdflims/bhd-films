-- =====================================================================
-- BHD FILMS — SUPABASE STORAGE SETUP
-- Run this AFTER schema.sql, in the SQL Editor.
-- =====================================================================

-- Bucket for payment receipt screenshots. PRIVATE - not publicly readable.
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- Bucket for the admin's payment QR code image. Public - anyone logged in
-- needs to see it on the Add Funds screen, and it contains no personal data.
insert into storage.buckets (id, name, public)
values ('payment-qr', 'payment-qr', true)
on conflict (id) do nothing;

-- Bucket for support ticket attachments (screenshots / payment proof).
-- PRIVATE - not publicly readable, same per-customer-folder rule as receipts.
insert into storage.buckets (id, name, public)
values ('support-attachments', 'support-attachments', false)
on conflict (id) do nothing;

-- Bucket for admin-uploaded proof-of-payment photos when a refund is
-- paid out via bank/UPI instead of the wallet. PRIVATE - only the
-- customer it belongs to (and admins) can view it.
insert into storage.buckets (id, name, public)
values ('refund-receipts', 'refund-receipts', false)
on conflict (id) do nothing;

-- Bucket for customer-uploaded photos when REQUESTING a refund (e.g. a
-- screenshot of their UPI QR code, or their own payment receipt) so the
-- admin knows where/how to send a bank/UPI refund. PRIVATE - only the
-- customer who uploaded it (and admins) can view it.
insert into storage.buckets (id, name, public)
values ('refund-customer-proof', 'refund-customer-proof', false)
on conflict (id) do nothing;

-- ---------------- receipts bucket policies ----------------
-- Customers must upload to a path that starts with their own user id,
-- e.g. "receipts/<their-uid>/1699999999.jpg". The app code enforces this
-- path shape; these policies enforce it for real at the database level.

create policy "receipts_insert_own_folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'receipts'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Lets an admin upload a payment screenshot into a CUSTOMER's own folder
-- on their behalf (see admin_create_fund_request_for_customer()) - for
-- when the customer's own upload keeps failing and they send the admin
-- the screenshot directly instead. RLS policies for the same command
-- are OR'd together, so this sits alongside the customer's own-folder
-- policy above rather than replacing it.
create policy "receipts_insert_admin_on_behalf"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'receipts'
  and public.is_admin()
);

create policy "receipts_select_own_or_admin"
on storage.objects for select to authenticated
using (
  bucket_id = 'receipts'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);

-- No update/delete policy is created on purpose: receipts must never be
-- edited or removed, preserving full re-upload history (spec #22).

-- ---------------- payment-qr bucket policies ----------------
create policy "payment_qr_public_read"
on storage.objects for select
using (bucket_id = 'payment-qr');

create policy "payment_qr_admin_write"
on storage.objects for insert to authenticated
with check (bucket_id = 'payment-qr' and public.has_permission('manage_payment_settings'));

create policy "payment_qr_admin_update"
on storage.objects for update to authenticated
using (bucket_id = 'payment-qr' and public.has_permission('manage_payment_settings'));

create policy "payment_qr_admin_delete"
on storage.objects for delete to authenticated
using (bucket_id = 'payment-qr' and public.has_permission('manage_payment_settings'));

-- ---------------- support-attachments bucket policies ----------------
create policy "support_attachments_insert_own_folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'support-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "support_attachments_select_own_or_admin"
on storage.objects for select to authenticated
using (
  bucket_id = 'support-attachments'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);

-- ---------------- refund-receipts bucket policies ----------------
-- Only admins ever UPLOAD here (they're the ones paying out a refund
-- via bank/UPI and attaching proof). The customer it belongs to can
-- only ever VIEW it, never upload/change it themselves.
create policy "refund_receipts_insert_admin"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'refund-receipts'
  and public.is_admin()
);

create policy "refund_receipts_select_own_or_admin"
on storage.objects for select to authenticated
using (
  bucket_id = 'refund-receipts'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);

-- ---------------- refund-customer-proof bucket policies ----------------
-- The customer uploads here themselves (own folder only) when requesting
-- a refund. Only they (and admins) can ever view it.
create policy "refund_customer_proof_insert_own_folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'refund-customer-proof'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "refund_customer_proof_select_own_or_admin"
on storage.objects for select to authenticated
using (
  bucket_id = 'refund-customer-proof'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);
