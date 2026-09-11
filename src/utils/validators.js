// Target link (platform URL) validation.
// IMPORTANT: this only validates the URL *format/domain*. It never confirms
// that the target actually exists, is public, or is eligible - that is
// explicitly out of scope, same as the server-side check.

const PATTERNS = {
  instagram: /^https?:\/\/(www\.)?instagram\.com\/.+/i,
  // fb.watch is Facebook's own share-link domain for video posts (same
  // idea as TikTok's vm./vt. links below) - needs accepting alongside the
  // plain facebook.com/fb.com links.
  facebook: /^https?:\/\/(www\.)?(facebook\.com|fb\.com|fb\.watch)\/.+/i,
  // vm./vt. are TikTok's own short-share-link subdomains (what the app's
  // native "Share" button actually gives you), m. is the mobile site -
  // all 3 need to be accepted alongside the plain tiktok.com/@user/video/…
  // links, or a customer pasting a real link off their phone gets wrongly
  // rejected.
  tiktok: /^https?:\/\/(www\.|vm\.|vt\.|m\.)?tiktok\.com\/.+/i,
  youtube: /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\/.+/i,
  twitter: /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/.+/i,
  telegram: /^https?:\/\/(www\.)?(t\.me|telegram\.me)\/.+/i,
  whatsapp: /^https?:\/\/(www\.)?(wa\.me|chat\.whatsapp\.com)\/.+/i,
  spotify: /^https?:\/\/(open\.)?spotify\.com\/.+/i,
  threads: /^https?:\/\/(www\.)?threads\.net\/.+/i,
  linkedin: /^https?:\/\/(www\.)?linkedin\.com\/.+/i,
  snapchat: /^https?:\/\/(www\.)?snapchat\.com\/.+/i,
  pinterest: /^https?:\/\/(www\.)?pinterest\.[a-z.]+\/.+/i
}

const LABELS = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  twitter: 'X / Twitter',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  spotify: 'Spotify',
  threads: 'Threads',
  linkedin: 'LinkedIn',
  snapchat: 'Snapchat',
  pinterest: 'Pinterest'
}

export function platformLabel(platformKey) {
  return LABELS[platformKey] || 'target'
}

// platformKey comes from services.target_platform. 'custom'/'other'/unknown
// falls back to a generic http(s) URL check.
export function isValidTargetLink(platformKey, url) {
  if (!url || !url.trim()) return false
  const trimmed = url.trim()
  const pattern = PATTERNS[platformKey]
  if (pattern) return pattern.test(trimmed)
  // generic fallback: must be a well-formed http(s) URL
  try {
    const u = new URL(trimmed)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function targetLinkErrorMessage(platformKey) {
  const label = LABELS[platformKey]
  if (label) return `Please enter a valid ${label} link.`
  return 'Please enter a valid link (must start with http:// or https://).'
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')
}

// ---------------------------------------------------------------
// Custom comments (services.requires_custom_comments)
// ---------------------------------------------------------------
// Customer types their own comment text, one comment per line. Blank
// lines don't count - only non-blank lines are treated as "a comment".
// Fewer lines than the ordered quantity is fine; more is not (checked
// here in the browser AND again, from scratch, inside place_order() on
// the server - the browser check can always be bypassed).

export function countCommentLines(text) {
  if (!text) return 0
  return text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0).length
}

// Trims a comments block down to at most maxLines non-blank lines as
// the customer types/pastes, without touching earlier blank lines - so
// it never fights the customer's own formatting, it just stops letting
// them go past their selected quantity.
export function capCommentLines(text, maxLines) {
  if (!text || !maxLines || maxLines <= 0) return text
  const lines = text.split('\n')
  let nonBlank = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length > 0) {
      nonBlank++
      if (nonBlank > maxLines) {
        return lines.slice(0, i).join('\n')
      }
    }
  }
  return text
}

// null when the comments are fine to submit; otherwise a customer-facing
// error message. quantity may be null/blank (customer hasn't entered a
// quantity yet) - in that case only the "at least one" check applies.
export function commentsErrorMessage(count, quantity) {
  if (count === 0) return 'Please enter at least one comment (one per line).'
  if (quantity && count > quantity) {
    return `You entered ${count} comments but only selected a quantity of ${quantity}. Please remove ${count - quantity}.`
  }
  return null
}
