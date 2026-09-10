// Shrinks a photo (e.g. a receipt screenshot straight off someone's phone
// camera) down to a small, upload-friendly JPEG before it ever reaches
// Supabase Storage. Runs entirely in the browser using <canvas> - no extra
// libraries to install, so it works everywhere the app already runs.
//
// A 7-100MB camera photo (typically 3000-4000px wide) comes back down to
// roughly 100-400KB, since receipts only need to be sharp enough to read
// numbers/text, not printed. That is a huge cut in what actually lands in
// storage for every upload.
//
// Non-image files (like a PDF receipt) and files that are already small
// pass through untouched. If anything about compression fails for any
// reason, the original file is used instead - a slightly bigger upload is
// always better than a blocked one.

const DEFAULT_MAX_DIMENSION = 1600
const DEFAULT_QUALITY = 0.72
const SKIP_IF_UNDER_BYTES = 300 * 1024 // already small - not worth the work

export async function compressImage(file, options = {}) {
  if (!file || !file.type || !file.type.startsWith('image/')) return file
  if (file.size <= SKIP_IF_UNDER_BYTES) return file

  const maxDimension = options.maxDimension || DEFAULT_MAX_DIMENSION
  const quality = options.quality || DEFAULT_QUALITY

  try {
    const bitmap = await createImageBitmap(file)
    let { width, height } = bitmap
    if (width > maxDimension || height > maxDimension) {
      const scale = maxDimension / Math.max(width, height)
      width = Math.max(1, Math.round(width * scale))
      height = Math.max(1, Math.round(height * scale))
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob || blob.size >= file.size) return file // compression didn't help - keep the original

    const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], newName, { type: 'image/jpeg', lastModified: Date.now() })
  } catch {
    return file
  }
}
