import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import Loader from '../../components/common/Loader'
import { formatCurrency } from '../../utils/format'
import { getRange } from '../../utils/dateRanges'

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'custom', label: 'Custom Range' }
]

export default function Reports() {
  const [preset, setPreset] = useState('month')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      const range = preset === 'custom' ? getRange('custom', from, to) : getRange(preset)

      let orderQuery = supabase.from('orders').select('*')
      let fundQuery = supabase.from('fund_requests').select('*').eq('status', 'approved')
      if (range.from) orderQuery = orderQuery.gte('created_at', range.from)
      if (range.to) orderQuery = orderQuery.lte('created_at', range.to)
      if (range.from) fundQuery = fundQuery.gte('created_at', range.from)
      if (range.to) fundQuery = fundQuery.lte('created_at', range.to)

      const [testProfilesRes, orderRes, fundRes] = await Promise.all([
        supabase.from('profiles').select('id').eq('is_test_account', true),
        orderQuery,
        fundQuery
      ])
      if (!mounted) return

      // Exclude any account flagged as a test account so testing never
      // shows up as real revenue/funds in these reports.
      const testIds = new Set((testProfilesRes.data || []).map((p) => p.id))
      const orders = (orderRes.data || []).filter((o) => !testIds.has(o.user_id))
      const funds = (fundRes.data || []).filter((f) => !testIds.has(f.user_id))
      setData({
        orderCount: orders.length,
        revenue: orders.reduce((s, o) => s + Number(o.grand_total), 0),
        fundsApproved: funds.reduce((s, f) => s + Number(f.amount), 0),
        byStatus: orders.reduce((acc, o) => {
          acc[o.status] = (acc[o.status] || 0) + 1
          return acc
        }, {})
      })
      setLoading(false)
    }
    if (preset !== 'custom' || (from && to)) load()
    else setLoading(false)
    return () => {
      mounted = false
    }
  }, [preset, from, to])

  return (
    <div>
      <h1 style={{ fontSize: 19, margin: '0 0 16px' }}>Reports</h1>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {PRESETS.map((p) => (
          <button key={p.key} className={`chip ${preset === p.key ? 'chip-gold' : ''}`} style={{ border: 'none', cursor: 'pointer' }} onClick={() => setPreset(p.key)}>
            {p.label}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <div className="grid-2" style={{ marginBottom: 16 }}>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      )}

      {loading ? (
        <Loader />
      ) : !data ? (
        <p className="text-faint" style={{ fontSize: 13 }}>Select a custom date range to view the report.</p>
      ) : (
        <>
          <div className="stats-grid" style={{ marginBottom: 20 }}>
            <div className="stat-card">
              <div className="stat-label">Orders Placed</div>
              <div className="stat-value">{data.orderCount}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Revenue</div>
              <div className="stat-value text-gold">{formatCurrency(data.revenue)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Funds Approved</div>
              <div className="stat-value text-success">{formatCurrency(data.fundsApproved)}</div>
            </div>
          </div>

          <div className="surface-card">
            <div className="section-title">Orders by Status</div>
            {Object.keys(data.byStatus).length === 0 && <p className="text-faint" style={{ fontSize: 12.5 }}>No orders in this range.</p>}
            {Object.entries(data.byStatus).map(([status, count]) => (
              <div key={status} className="row-between" style={{ fontSize: 13, marginBottom: 8 }}>
                <span className="text-dim">{status}</span>
                <span style={{ fontWeight: 700 }}>{count}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
