import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Loader from '../../components/common/Loader'
import CopyButton from '../../components/common/CopyButton'
import { formatCurrency, formatRate, formatDate } from '../../utils/format'

const STATUSES = ['received', 'processing', 'completed', 'cancelled', 'refunded']

export default function Orders() {
  const [loading, setLoading] = useState(true)
  const [orders, setOrders] = useState([])
  const [statusFilter, setStatusFilter] = useState('all')
  const [expanded, setExpanded] = useState(null)
  const [updating, setUpdating] = useState(null)

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
    if (status === order.status) return

    const movesToRefundState = (status === 'cancelled' || status === 'refunded') && order.status !== 'cancelled' && order.status !== 'refunded'
    if (movesToRefundState) {
      const paidAmount = order.grand_total - (order.discount_amount || 0)
      const ok = window.confirm(
        `Mark ${order.order_code} as "${status}"? This will automatically refund ${formatCurrency(paidAmount)} to the customer's wallet (what they actually paid after any coupon discount).`
      )
      if (!ok) return
    } else {
      // Every other status change also gets a confirm now, not just the
      // refund ones - a wrong tap here is visible straight to the
      // customer, so it's worth one extra "are you sure" either way.
      const ok = window.confirm(`Mark ${order.order_code} as "${status}"? The customer will immediately see this updated status.`)
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
                    <div key={item.id} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px dashed var(--border-soft)' }}>
                      <div className="row-between" style={{ fontSize: 12, alignItems: 'flex-start' }}>
                        <span>
                          {item.service_name_snapshot}
                          <br />
                          <span className="text-faint" style={{ display: 'block', marginTop: 3, lineHeight: 1.7 }}>
                            {item.is_fixed_price_snapshot ? (
                              'Fixed one-time package price (no quantity involved)'
                            ) : (
                              <>
                                Rate: <strong style={{ color: 'var(--text)' }}>{formatRate(item.applied_rate)}</strong> per 1,000 units
                                {' = '}
                                <strong className="text-gold">{formatCurrency(item.item_total)}</strong> charged
                              </>
                            )}
                          </span>
                        </span>
                        <span style={{ flexShrink: 0, fontWeight: 700 }}>{formatCurrency(item.item_total)}</span>
                      </div>

                      {/* Copy-ready fulfilment fields - exactly what needs
                          pasting into the supplier panel to process this
                          line item, with a one-tap copy for each. */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
                        {item.service_external_id_snapshot != null && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'var(--surface-strong)', borderRadius: 8, padding: '3px 3px 3px 8px' }}>
                            <span className="text-faint" style={{ fontSize: 9.5 }}>ID</span>
                            <strong className="text-gold" style={{ fontSize: 11 }}>{item.service_external_id_snapshot}</strong>
                            <CopyButton text={item.service_external_id_snapshot} label="service ID" size={11} />
                          </span>
                        )}
                        {!item.is_fixed_price_snapshot && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'var(--surface-strong)', borderRadius: 8, padding: '3px 3px 3px 8px' }}>
                            <span className="text-faint" style={{ fontSize: 9.5 }}>Qty</span>
                            <strong style={{ fontSize: 11 }}>{item.quantity}</strong>
                            <CopyButton text={item.quantity} label="quantity" size={11} />
                          </span>
                        )}
                        {item.target_link && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'var(--surface-strong)', borderRadius: 8, padding: '3px 3px 3px 8px', maxWidth: '100%' }}>
                            <span className="text-faint" style={{ fontSize: 9.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>
                              {item.target_link}
                            </span>
                            <CopyButton text={item.target_link} label="link" size={11} />
                          </span>
                        )}
                      </div>

                      {item.custom_comments && (
                        <div style={{ marginTop: 8, background: 'var(--surface-strong)', borderRadius: 10, padding: 8 }}>
                          <div className="row-between" style={{ marginBottom: 4 }}>
                            <span className="text-faint" style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                              Custom Comments ({item.custom_comments.split('\n').filter(Boolean).length})
                            </span>
                            <CopyButton text={item.custom_comments} label="all comments" size={12} />
                          </div>
                          <pre
                            style={{
                              fontSize: 11,
                              margin: 0,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              fontFamily: 'inherit'
                            }}
                          >
                            {item.custom_comments}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
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
