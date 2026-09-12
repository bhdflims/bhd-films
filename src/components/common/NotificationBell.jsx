import { useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, MessageSquareText, X } from 'lucide-react'
import { useNotifications } from '../../hooks/useNotifications'
import { timeAgo } from '../../utils/format'

const GUTTER = 12 // matches the app's usual side padding

// Notification Bell for the customer header. Shows an unread badge and a
// dropdown of recent notifications (currently: support ticket replies).
// Clicking a notification marks it read and opens the ticket it's about.
export default function NotificationBell() {
  const navigate = useNavigate()
  const { notifications, unreadCount, markRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef(null)
  const [pos, setPos] = useState({ top: 60, right: GUTTER, width: 320 })

  // Positions the dropdown using the bell button's ACTUAL on-screen
  // location (position: fixed, measured against the real viewport)
  // instead of anchoring it to the small button's own box with CSS
  // alone. On some Android phones/browsers that old anchor pushed the
  // panel's left edge straight off the side of the screen (reported:
  // "coming too much to the corner" - worked fine on iPhone, but the
  // exact math differs enough by device/browser that anchoring in CSS
  // alone isn't reliable). This is measured and clamped so the panel can
  // never overflow either edge, on any device, and useLayoutEffect (not
  // useEffect) means it's positioned correctly before the very first
  // paint - no visible jump.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    function place() {
      const rect = buttonRef.current.getBoundingClientRect()
      const width = Math.min(320, window.innerWidth - GUTTER * 2)
      let right = window.innerWidth - rect.right
      if (right + width > window.innerWidth - GUTTER) {
        right = window.innerWidth - width - GUTTER
      }
      if (right < GUTTER) right = GUTTER
      setPos({ top: rect.bottom + 8, right, width })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  async function handleClick(n) {
    if (!n.is_read) await markRead(n.id)
    setOpen(false)
    if (n.type === 'support_reply' && n.related_id) {
      navigate(`/support/${n.related_id}`)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button ref={buttonRef} className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label="Notifications" style={{ position: 'relative' }}>
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              background: 'var(--crimson, #e0435a)',
              color: '#fff',
              fontSize: 9.5,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 3px',
              border: '2px solid var(--bg, #0c0a10)'
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div
            style={{
              position: 'fixed',
              top: pos.top,
              right: pos.right,
              width: pos.width,
              maxHeight: 380,
              overflowY: 'auto',
              zIndex: 41,
              padding: 8,
              background: 'var(--bg-elevated, #131019)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: '0 12px 32px rgba(0,0,0,0.45)'
            }}
          >
            <div className="row-between" style={{ padding: '6px 6px 10px' }}>
              <strong style={{ fontSize: 13.5 }}>Notifications</strong>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
                <X size={14} />
              </button>
            </div>

            {notifications.length === 0 && (
              <p className="text-faint" style={{ fontSize: 12, padding: '10px 6px' }}>
                No notifications yet.
              </p>
            )}

            {notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                style={{
                  display: 'flex',
                  gap: 10,
                  width: '100%',
                  textAlign: 'left',
                  background: n.is_read ? 'none' : 'rgba(212,175,55,0.08)',
                  border: 'none',
                  borderRadius: 10,
                  padding: '10px 8px',
                  cursor: 'pointer'
                }}
              >
                <MessageSquareText size={16} color={n.is_read ? 'var(--text-faint, #8b8494)' : 'var(--gold, #d4af37)'} style={{ flexShrink: 0, marginTop: 2 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: n.is_read ? 500 : 700 }}>{n.title}</span>
                  <span className="text-faint" style={{ display: 'block', fontSize: 11.5, marginTop: 2 }}>{n.message}</span>
                  <span className="text-faint" style={{ display: 'block', fontSize: 10.5, marginTop: 3 }}>{timeAgo(n.created_at)}</span>
                </span>
                {!n.is_read && <span style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--gold, #d4af37)', flexShrink: 0, marginTop: 5 }} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
