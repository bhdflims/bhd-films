import { supabase } from '../lib/supabase'
import { compressImage } from './imageCompress'

// Uploads a screenshot/proof file to the private support-attachments
// bucket, scoped to the uploader's own folder (same pattern as receipts).
// Returns the storage path to save on the ticket/message row.
export async function uploadSupportAttachment(userId, file) {
  if (!file) return null
  const uploadFile = await compressImage(file)
  const safeName = uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${userId}/${Date.now()}-${safeName}`
  const { error } = await supabase.storage.from('support-attachments').upload(path, uploadFile)
  if (error) throw error
  return path
}

// The bucket is private - generate a short-lived signed URL on demand
// whenever an attachment needs to actually be viewed.
export async function getSupportAttachmentUrl(path) {
  if (!path) return null
  const { data, error } = await supabase.storage.from('support-attachments').createSignedUrl(path, 300)
  if (error) throw error
  return data?.signedUrl || null
}
