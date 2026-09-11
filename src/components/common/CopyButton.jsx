import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

// Small, reusable one-click "copy to clipboard" icon button. Used anywhere
// staff need to grab an exact value (service ID, quantity, target link,
// a customer's full comment block...) to paste straight into the SMM
// supplier panel - no re-typing, no risk of a typo breaking an order.
export default function CopyButton({ text, label, size = 12, style }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy(e) {
    e.stopPropagation()
    if (text === null || text === undefined || text === '') return
    try {
      await navigator.clipboard.writeText(String(text))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API can be unavailable (older browser, no permission) -
      // the value is still shown on screen and can be selected by hand.
    }
  }

  return (
    <button
      type="button"
      className="icon-btn"
      style={{ width: size + 14, height: size + 14, flexShrink: 0, ...style }}
      onClick={handleCopy}
      aria-label={label ? `Copy ${label}` : 'Copy'}
      disabled={text === null || text === undefined || text === ''}
    >
      {copied ? <Check size={size} /> : <Copy size={size} />}
    </button>
  )
}
