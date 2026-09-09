import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Loader from '../../components/common/Loader'
import { formatCurrency, formatDate } from '../../utils/format'
import { getRange } from '../../utils/dateRanges'
import { useAuth } from '../../context/AuthContext'

const FILTERS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'all', label: 'All Time' }
]

export default function Dashboard() {
  const navigate = useNavigate()
  const { updatePassword } = useAuth()
  const [pwOpen, setPwOpen] = useState(false)
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwError, setPwError] = useState('')
  const [pwDone, setPwDone] = useState(false)
  const [filter, setFilter] = useState('today')
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)
  const [recentOrders, setRecentOrders] = useState([])
  const [recentFundRequests, setRecentFundRequests] = useState([])

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      const { from } = filter === 'all' ? { from: null } : getRange(filter)

      const [customersRes, newCustomersRes, walletsRes, ordersRes, fundReqRes, recentOrdersRes, recentFundRes] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        from
          ? supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', from)
          : supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('wallets').select('available_fund, total_fund_added, total_fund_used'),
        from
          ? supabase.from('orders').select('id', { count: 'exact', head: true }).gte('created_at', from)
          : supabase.from('orders').select('id', { count: 'exact', head: true }),
        supabase.from('fund_requests').select('status').then((r) => r),
        supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(6),
        supabase.from('fund_requests').select('*').order('created_at', { ascending: false }).limit(6)
      ])

      const wallets = walletsRes.data || []
      const totalBalance = wallets.reduce((s, w) => s + Number(w.available_fund), 0)
      const totalAdded = wallets.reduce((s, w) => s + Number(w.total_fund_added), 0)
      const totalUsed = wallets.reduce((s, w) => s + Number(w.total_fund_used), 0)

      const fundStatuses = fundReqRes.data || []
      const pending = fundStatuses.filter((r) => ['pending', 'under_review', 'reupload_required'].includes(r.status)).length
      const approved = fundStatuses.filter((r) => r.status === 'approved').length
      const rejected = fundStatuses.filter((r) => r.status === 'rejected').length

      if (!mounted) return
      setStats({
        totalCustomers: customersRes.count || 0,
        newCustomers: newCustomersRes.count || 0,
        totalBalance,
        totalAdded,
        totalUsed,
        pending,
        approved,
        rejected,
        totalOrders: ordersRes.count || 0
      })
      setRecentOrders(recentOrdersRes.data || [])
      setRecentFundRequests(recentFundRes.data || [])
      setLoading(false)
    }
    load()
    return () => {
      mounted = false
    }
  }, [filter])

  async function handleSetPassword() {
    setPwError('')
    setPwDone(false)
    if (pw1.length < 6) {
      setPwError('Password must be at least 6 characters.')
      return
    }
    if (pw1 !== pw2) {
      setPwError('Passwords do not match.')
      return
    }
    setPwBusy(true)
    try {
      await updatePassword(pw1)
      setPwDone(true)
      setPw1('')
      setPw2('')
    } catch (e) {
      setPwError(e.message || 'Could not set password.')
    } finally {
      setPwBusy(false)
    }
  }

  if (loading || !stats) return <Loader />

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 19, margin: 0 }}>Dashboard</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip ${filter === f.key ? 'chip-gold' : ''}`}
              style={{ cursor: 'pointer', border: 'none' }}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="surface-card" style={{ marginBottom: 16 }}>
        <button
          className="row-between"
          style={{ width: '100%', background: 'none', border: 'none' }}
          onClick={() => setPwOpen((v) => !v)}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13.5 }}>
            <KeyRound size={16} /> Set / Change Login Password
          </span>
          <span className="text-faint" style={{ fontSize: 11 }}>{pwOpen ? 'Hide' : 'Show'}</span>
        </button>
        {pwOpen && (
          <div style={{ marginTop: 12 }}>
            <p className="text-faint" style={{ fontSize: 11.5, marginBottom: 10 }}>
              Set a password for the account you're logged into right now, so you can log in with email + password next time instead of always using Google.
            </p>
            <div style={{ marginBottom: 10 }}>
              <span className="field-label">New Password</span>
              <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} autoComplete="new-password" />
            </div>
            <div style={{ marginBottom: 10 }}>
              <span className="field-label">Confirm Password</span>
              <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
            </div>
            {pwError && <div className="field-error" style={{ marginBottom: 10 }}>{pwError}</div>}
            {pwDone && <p className="text-success" style={{ fontSize: 12, marginBottom: 10 }}>Password set! You can now log in with your email + this password.</p>}
            <button className="btn btn-primary btn-sm" onClick={handleSetPassword} disabled={pwBusy}>
              {pwBusy ? 'Saving…' : 'Save Password'}
            </button>
          </div>
        )}
      </div>

      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <Stat label="Total Customers" value={stats.totalCustomers} />
        <Stat label="New Customers" value={stats.newCustomers} accent="text-success" />
        <Stat label="Total Wallet Balance" value={formatCurrency(stats.totalBalance)} accent="text-gold" />
        <Stat label="Total Funds Added" value={formatCurrency(stats.totalAdded)} accent="text-success" />
        <Stat label="Total Funds Used" value={formatCurrency(stats.totalUsed)} />
        <Stat label="Pending Requests" value={stats.pending} accent="text-warning" />
        <Stat label="Approved Requests" value={stats.approved} accent="text-success" />
        <Stat label="Rejected Requests" value={stats.rejected} accent="text-danger" />
        <Stat label="Total Orders" value={stats.totalOrders} />
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: '1fr', gap: 16 }}>
        <div className="surface-card">
          <div className="section-title">Recent Orders</div>
          {recentOrders.length === 0 && <p className="text-faint" style={{ fontSize: 12.5 }}>No orders yet.</p>}
          {recentOrders.map((o) => (
            <div key={o.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => navigate('/admin/orders')}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{o.order_code}</div>
                <div className="text-faint" style={{ fontSize: 11 }}>{formatDate(o.created_at)}</div>
              </div>
              <span className="chip chip-info">{o.status}</span>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{formatCurrency(o.grand_total)}</span>
            </div>
          ))}
        </div>

        <div className="surface-card">
          <div className="section-title">Recent Fund Requests</div>
          {recentFundRequests.length === 0 && <p className="text-faint" style={{ fontSize: 12.5 }}>No fund requests yet.</p>}
          {recentFundRequests.map((r) => (
            <div key={r.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => navigate('/admin/fund-requests')}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{r.request_code}</div>
                <div className="text-faint" style={{ fontSize: 11 }}>{formatDate(r.created_at)}</div>
              </div>
              <span className="chip chip-warning">{r.status}</span>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{formatCurrency(r.amount)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, accent }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${accent || ''}`}>{value}</div>
    </div>
  )
}
