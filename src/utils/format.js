export function formatCurrency(amount) {
  const value = Number(amount ?? 0)
  return `₹${value.toLocaleString('en-IN', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  })}`
}

// For PER-UNIT RATES specifically (a service's price per follower/view/etc),
// not for totals, wallet balances, or anything else - those should keep
// using formatCurrency above. Rates can be set as small as ₹0.0001 (see the
// "New rate" field in Rate Control, which allows 4 decimal places), and
// formatCurrency's normal 2-decimal rounding would show a rate like ₹0.001
// as "₹0.00" - looking exactly like it's free, when it isn't. This shows up
// to 4 decimal places instead, only when the extra precision is actually
// needed, so ordinary rates like ₹1.50 still display simply.
export function formatRate(amount) {
  const value = Number(amount ?? 0)
  return `₹${value.toLocaleString('en-IN', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 4
  })}`
}

export function formatDate(dateString) {
  if (!dateString) return '-'
  const d = new Date(dateString)
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function formatDateShort(dateString) {
  if (!dateString) return '-'
  const d = new Date(dateString)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function timeAgo(dateString) {
  if (!dateString) return '-'
  const seconds = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDateShort(dateString)
}

// Turns a raw byte count (as stored in Supabase Storage's own metadata)
// into something a non-technical admin can read at a glance, e.g.
// "482 KB" or "1.3 GB". Used on the Storage Cleanup page.
export function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = value / 1024
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size < 10 ? size.toFixed(2) : size < 100 ? size.toFixed(1) : Math.round(size)} ${units[unitIndex]}`
}

export function initialsFromName(name) {
  if (!name) return 'BF'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
