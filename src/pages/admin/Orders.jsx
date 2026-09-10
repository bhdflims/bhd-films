import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Copy, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Loader from '../../components/common/Loader'
import { formatCurrency, formatDate } from '../../utils/format'

const STATUSES = ['received', 'processing', 'completed', 'cancelled', 'refunded']

export default function Orders() {
  const [loading, setLoading] = useState(true)
  const [orders, setOrders] = useState([])
  const [statusFilter, setStatusFilter] = useState('all')
  const [expanded, setExpanded] = useState(null)
  const [updating, setUpdating] = useState(null)
  const [copiedId, setCopiedId] = useState(null)

  function copyLink(url, orderId) {
    navigator.clipboard?.writeText(url)
    setCopiedId(orderId)
    setTimeout(() => setCopiedId((id) => (id === orderId ? null : id)), 1500)
  }

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(*), profiles:user_id(username, email)')
      .order('created_at', { ascending: false })
      .limit(200)
    setOrders(data || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('admin-orders-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  async function handleStatusChange(order, status) {
    const movesToRefundState = (status === 'cancelled' || status === 'refunded') && order.status !== 'cancelled' && order.status !== 'refunded'
    if (movesToRefundState) {
      const paidAmount = order.grand_total - (order.discount_amount || 0)
      const ok = window.confirm(
        `This will automatically refund ${formatCurrency(paidAmount)} to the customer's wallet (what they actually paid after any coupon discount). Continue?`
      )
      if (!ok) return
    }
    setUpdating(order.id)
    const { error } = await supabase.rpc('admin_update_order_status', { p_order_id: order.id, p_status: status })
    setUpdating(null)
    if (error) {
      window.alert(error.message)
      return
    }
    load()
  }

  const visible = statusFilter === 'all' ? orders : orders.filter((o) => o.status === statusFilter)

  if (loading) return <Loader />

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 19, margin: 0 }}>Orders</h1>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 'auto' }}>
          <option value="all">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="surface-card">
        {visible.length === 0 && <p className="text-faint" style={{ fontSize: 13 }}>No orders found.</p>}
        {visible.map((order) => {
          const open = expanded === order.id
          return (
            <div key={order.id} style={{ borderBottom: '1px solid var(--border-soft)', padding: '12px 4px' }}>
              <div className="row-between" style={{ cursor: 'pointer' }} onClick={() => setExpanded(open ? null : order.id)}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{order.order_code}</div>
                  <div className="text-faint" style={{ fontSize: 11 }}>
                    {order.profiles?.username || order.profiles?.email} · {formatDate(order.created_at)}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{formatCurrency(order.grand_total)}</span>
                  {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
              </div>

              {open && (
                <div style={{ marginTop: 10 }}>
                  {(order.order_items || []).map((item) => (
                    <div key={item.id} className="row-between" style={{ fontSize: 12, marginBottom: 6 }}>
                      <span>{item.service_name_snapshot} (Qty {item.quantity} × {formatCurrency(item.applied_rate)})</span>
                      <span>{formatCurrency(item.item_total)}</span>
                    </div>
                  ))}
                  {order.order_items?.[0]?.target_link && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <p className="text-faint" style={{ fontSize: 11, wordBreak: 'break-all', margin: 0, flex: 1 }}>
                        {order.order_items[0].target_link}
                      </p>
                      <button
                        type="button"
                        className="icon-btn"
                        style={{ width: 26, height: 26, flexShrink: 0 }}
                        onClick={() => copyLink(order.order_items[0].target_link, order.id)}
                        aria-label="Copy link"
                      >
                        {copiedId === order.id ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    </div>
                  )}
                  {order.discount_amount > 0 && (
                    <div className="row-between" style={{ fontSize: 12, marginTop: 8 }}>
                      <span className="text-faint">Coupon {order.coupon_code ? `(${order.coupon_code})` : ''} Discount</span>
                      <span className="text-success">- {formatCurrency(order.discount_amount)}</span>
                    </div>
                  )}
                  <div className="row-between" style={{ marginTop: 10 }}>
                    <span className="text-faint" style={{ fontSize: 12 }}>Update Status</span>
                    <select
                      value={order.status}
                      disabled={updating === order.id}
                      onChange={(e) => handleStatusChange(order, e.target.value)}
                      style={{ width: 'auto' }}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
