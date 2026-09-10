import { useState } from 'react'
import { Copy, Check, Sparkles } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { getIcon } from '../../utils/iconMap'
import { formatCurrency } from '../../utils/format'

// A single "gift box" that the customer taps to unbox. Closed, it just
// wobbles gently to draw the eye. Tapping it plays a spring-open reveal
// showing the coupon's real code with a one-tap copy button, ready to
// paste into the coupon field at checkout.
function CouponCard({ coupon }) {
  const [opened, setOpened] = useState(false)
  const [copied, setCopied] = useState(false)
  const Icon = getIcon(coupon.icon)

  function copy() {
    navigator.clipboard?.writeText(coupon.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const discountText =
    coupon.discount_type === 'percent' ? `${coupon.discount_value}% OFF` : `${formatCurrency(coupon.discount_value)} OFF`

  return (
    <div style={{ flex: '0 0 auto', width: 240 }}>
      <AnimatePresence mode="wait" initial={false}>
        {!opened ? (
          <motion.button
            key="closed"
            onClick={() => setOpened(true)}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            whileTap={{ scale: 0.95 }}
            style={{
              width: '100%',
              border: '1px solid rgba(212,175,55,0.25)',
              cursor: 'pointer',
              borderRadius: 'var(--radius-lg)',
              padding: '22px 16px',
              textAlign: 'center',
              background: 'linear-gradient(135deg, #3a2d10, #1a1408 65%)',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            <motion.div
              animate={{ rotate: [0, -8, 8, -8, 0], y: [0, -4, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 1.1 }}
              style={{
                display: 'inline-flex',
                width: 52,
                height: 52,
                borderRadius: 16,
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(212,175,55,0.18)',
                marginBottom: 10
              }}
            >
              <Icon size={24} color="var(--gold)" />
            </motion.div>
            <div style={{ fontWeight: 800, fontSize: 14, color: '#fff' }}>{coupon.title}</div>
            <div className="text-faint" style={{ fontSize: 11, marginTop: 4 }}>
              Tap to unbox your offer
            </div>
          </motion.button>
        ) : (
          <motion.div
            key="open"
            initial={{ opacity: 0, scale: 0.85, rotateX: -25 }}
            animate={{ opacity: 1, scale: 1, rotateX: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            style={{
              borderRadius: 'var(--radius-lg)',
              padding: 16,
              background: 'linear-gradient(135deg, #3a2d10, #1a1408 65%)',
              border: '1px solid rgba(212,175,55,0.35)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Sparkles size={14} color="var(--gold)" />
              <span style={{ fontWeight: 800, fontSize: 13, color: '#fff' }}>{coupon.title}</span>
            </div>
            {coupon.description && (
              <p className="text-faint" style={{ fontSize: 11, margin: '0 0 10px' }}>
                {coupon.description}
              </p>
            )}
            <div style={{ fontWeight: 800, fontSize: 12.5, color: 'var(--gold)', marginBottom: 10 }}>
              {discountText}
              {coupon.min_order_amount > 0 ? ` on orders above ${formatCurrency(coupon.min_order_amount)}` : ''}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                border: '1.5px dashed rgba(212,175,55,0.5)',
                borderRadius: 12,
                padding: '9px 12px',
                background: 'rgba(0,0,0,0.25)'
              }}
            >
              <span style={{ fontWeight: 800, letterSpacing: 1.5, fontSize: 14, color: '#fff' }}>{coupon.code}</span>
              <button
                onClick={copy}
                style={{
                  border: 'none',
                  background: 'var(--gold)',
                  color: '#1a1408',
                  borderRadius: 8,
                  padding: '6px 10px',
                  fontSize: 11,
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  cursor: 'pointer',
                  flexShrink: 0
                }}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function CouponUnbox({ coupons }) {
  if (!coupons || coupons.length === 0) return null
  return (
    <div>
      <div className="section-title" style={{ marginBottom: 8 }}>
        <span>🎁 Special Offers</span>
      </div>
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
        {coupons.map((c) => (
          <CouponCard key={c.id} coupon={c} />
        ))}
      </div>
    </div>
  )
}
