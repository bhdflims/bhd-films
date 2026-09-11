import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, ShoppingBag, Banknote, Undo2, MessageSquare, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// Notification Bell for the admin panel. There's no separate "admin
// notifications" table - this just surfaces the same live counts already
// shown as sidebar badges (new orders, pending fund requests, pending
// refunds, unread support messages) in one dropdown, so admins get a
// single place to check "what needs my attention" without hunting through
// every section, and a badge that's visible even with the sidebar closed
// on mobile.
const ITEMS = [
  { key: 'orders', label: 'New Orders', sub: 'awaiting pickup', icon: ShoppingBag, to: '/admin/orders' },
  { key: 'funds', label: 'Fund Requests', sub: 'pending review', icon: Banknote, to: '/admin/fund-requests' },
  { key: 'refunds', label: 'Refund Requests', sub: 'pending review', icon: Undo2, to: '/admin/refunds' },
  { key: 'support', label: 'Support Tickets', sub: 'unread reply from customer', icon: MessageSquare, to: '/admin/support' }
]

export default function AdminNotificationBell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [counts, setCounts] = useState({ orders: 0, funds: 0, refunds: 0, support: 0 })
  // AdminLayout renders this component twice at once (the mobile topbar
  // copy and the desktop sidebar copy both sit in the DOM together, just
  // toggled by CSS, not by conditional rendering) - a shared, hardcoded
  // channel name would mean two Supabase realtime channels opening under
  // the exact same name at the same time, which is invalid and was
  // crashing the admin panel right after login. Each mounted copy now
  // gets its own unique channel name instead.
  const [channelName] = useState(() => `admin-notification-bell-${Math.random().toString(36).slice(2)}`)

  useEffect(() => {
    async function loadAll() {
      const [ordersRes, fundsRes, refundsRes, supportRes] = await Promise.all([
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'received'),
        supabase.from('fund_requests').select('id', { count: 'exact', head: true }).in('status', ['pending', 'under_review']),
        supabase.from('refund_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('support_tickets').select('id', { count: 'exact', head: true }).eq('has_unread_customer_message', true)
      ])
      setCounts({
        orders: ordersRes.count || 0,
        funds: fundsRes.count || 0,
        refunds: refundsRes.count || 0,
        support: supportRes.count || 0
      })
    }

    loadAll()

    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fund_requests' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'refund_requests' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, loadAll)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [channelName])

  const total = counts.orders + counts.funds + counts.refunds + counts.support

  function go(to) {
    setOpen(false)
    navigate(to)
  }

  return (
    <div style={{ position: 'relative' }}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label="Notifications" style={{ position: 'relative' }}>
        <Bell size={18} />
        {total > 0 && (
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
            {total > 9 ? '9+' : total}
          </span>
        )}
      </button>

      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              right: 0,
              width: 300,
              maxWidth: '88vw',
              zIndex: 41,
              padding: 8,
              background: 'var(--bg-elevated, #131019)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: '0 12px 32px rgba(0,0,0,0.45)'
            }}
          >
            <div className="row-between" style={{ padding: '6px 6px 10px' }}>
              <strong style={{ fontSize: 13.5 }}>Needs Attention</strong>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
                <X size={14} />
              </button>
            </div>

            {total === 0 && (
              <p className="text-faint" style={{ fontSize: 12, padding: '10px 6px' }}>
                All caught up - nothing pending right now.
              </p>
            )}

            {ITEMS.filter((item) => counts[item.key] > 0).map((item) => (
              <button
                key={item.key}
                onClick={() => go(item.to)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  textAlign: 'left',
                  background: 'rgba(212,175,55,0.08)',
                  border: 'none',
                  borderRadius: 10,
                  padding: '10px 8px',
                  cursor: 'pointer',
                  marginBottom: 4
                }}
              >
                <item.icon size={16} color="var(--gold, #d4af37)" style={{ flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700 }}>{item.label}</span>
                  <span className="text-faint" style={{ display: 'block', fontSize: 11, marginTop: 1 }}>{item.sub}</span>
                </span>
                <span
                  style={{
                    minWidth: 20,
                    height: 20,
                    borderRadius: 10,
                    background: 'var(--crimson, #e0435a)',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 5px',
                    flexShrink: 0
                  }}
                >
                  {counts[item.key]}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
