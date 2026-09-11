import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, Calendar, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Loader from '../../components/common/Loader'
import { formatCurrency, formatDate, formatDateShort } from '../../utils/format'
import { getRange } from '../../utils/dateRanges'
import { useAuth } from '../../context/AuthContext'

// yyyy-mm-dd in the viewer's own local time (never UTC) - matches exactly
// what an <input type="date"> expects/returns, and what dateRanges.js's
// "custom" branch parses back into a local-time Date.
function toDateInput(d) {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const FILTERS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'all', label: 'All Time' },
  { key: 'custom', label: 'Custom Date' }
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
  // "Today" moves at midnight - right after 12 AM, what was "today" a
  // minute ago becomes unreachable through Today/Week/Month/All Time (it's
  // now yesterday). Custom Date lets an admin pick any past day (or range)
  // by hand instead of losing access to it.
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [loading, setLoading] = useState(true)

  function pickYesterday() {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    const v = toDateInput(d)
    setCustomFrom(v)
    setCustomTo(v)
  }
  function pickLastNDays(n) {
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - (n - 1))
    setCustomFrom(toDateInput(from))
    setCustomTo(toDateInput(to))
  }
  const [stats, setStats] = useState(null)
  const [recentOrders, setRecentOrders] = useState([])
  const [recentFundRequests, setRecentFundRequests] = useState([])

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      const { from, to } =
        filter === 'all' ? { from: null, to: null } :
        filter === 'custom' ? getRange('custom', customFrom, customTo) :
        getRange(filter)
      // Bounds-check a timestamp against the selected period. Today/Week/
      // Month only ever have a lower bound (from "then" through right now),
      // but a Custom Date range needs an upper bound too, otherwise picking
      // a single past day would pull in everything from that day through
      // this very second.
      const inRange = (ts) => (!from || ts >= from) && (!to || ts <= to)

      const [testProfilesRes, profilesRes, walletsRes, ordersRes, fundReqRes, txRes, recentOrdersRes, recentFundRes] = await Promise.all([
        supabase.from('profiles').select('id').eq('is_test_account', true),
        supabase.from('profiles').select('id, created_at'),
        supabase.from('wallets').select('user_id, available_fund, total_fund_added, total_fund_used'),
        supabase.from('orders').select('id, user_id, created_at'),
        supabase.from('fund_requests').select('user_id, status, reviewed_at'),
        supabase.from('wallet_transactions').select('user_id, type, amount, balance_before, balance_after, created_at'),
        // Fetched wider than the 10 actually shown (see below) because
        // these now get filtered down to the selected period afterward -
        // a plain top-20-most-recent-overall could otherwise run out
        // before reaching enough rows that fall inside an older Custom
        // Date range.
        supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(50),
        supabase.from('fund_requests').select('*').order('created_at', { ascending: false }).limit(50)
      ])

      // Test accounts (flagged from a customer's admin detail page) never
      // count toward these business numbers - their orders/wallet activity
      // is filtered out here before anything is summed/counted.
      const testIds = new Set((testProfilesRes.data || []).map((p) => p.id))
      const isReal = (userId) => !testIds.has(userId)

      const profiles = (profilesRes.data || []).filter((p) => isReal(p.id))
      const totalCustomers = profiles.length
      const newCustomers = from ? profiles.filter((p) => inRange(p.created_at)).length : totalCustomers

      // "Total Wallet Balance" is a live snapshot (how much money is sitting
      // in wallets right now) so it intentionally ignores the Today/Week/
      // Month toggle - a balance doesn't have a "this week" version.
      const wallets = (walletsRes.data || []).filter((w) => isReal(w.user_id))
      const totalBalance = wallets.reduce((s, w) => s + Number(w.available_fund), 0)

      const orders = (ordersRes.data || []).filter((o) => isReal(o.user_id))
      const totalOrders = from ? orders.filter((o) => inRange(o.created_at)).length : orders.length

      // "Total Funds Added"/"Total Funds Used" USED to just sum each
      // wallet's lifetime total_fund_added/total_fund_used column - which
      // meant these two tiles silently showed the SAME all-time number no
      // matter which tab (Today/Week/Month/All Time) was selected, while
      // every other tile on this page actually changed. Now they're built
      // from wallet_transactions instead, scoped to the selected period the
      // same way Total Orders already was - a credit is anything that
      // raised a wallet's balance (a "fund_added" transaction from an
      // approved request, or a manual "add"/an upward "set" from Modify
      // Fund), a debit is anything that lowered it (a "fund_used"
      // transaction, or a "deduct"/downward "set"). Refund transactions are
      // deliberately left out of both - they're money moving back after
      // already being counted as "used", not a fresh addition.
      const tx = (txRes.data || []).filter((t) => isReal(t.user_id) && (!from || inRange(t.created_at)))
      let totalAdded = 0
      let totalUsed = 0
      for (const t of tx) {
        if (t.type === 'fund_added') {
          totalAdded += Number(t.amount)
        } else if (t.type === 'fund_used') {
          totalUsed += Number(t.amount)
        } else if (t.type === 'adjustment') {
          const delta = Number(t.balance_after) - Number(t.balance_before)
          if (delta > 0) totalAdded += delta
          else if (delta < 0) totalUsed += Math.abs(delta)
        }
      }

      // Pending is a live queue depth ("how many need my attention right
      // now"), not tied to when they were submitted, so - like Total
      // Wallet Balance above - it intentionally stays unscoped. Approved/
      // Rejected are scoped by reviewed_at (when the admin actually acted
      // on it), not created_at, so "Approved Requests" on the Today tab
      // means "approved today", matching what an admin actually remembers
      // doing that day - not "submitted today AND happens to be approved".
      const fundStatuses = (fundReqRes.data || []).filter((r) => isReal(r.user_id))
      const pending = fundStatuses.filter((r) => ['pending', 'under_review', 'reupload_required'].includes(r.status)).length
      const approved = fundStatuses.filter((r) => r.status === 'approved' && (!from || inRange(r.reviewed_at))).length
      const rejected = fundStatuses.filter((r) => r.status === 'rejected' && (!from || inRange(r.reviewed_at))).length

      if (!mounted) return
      setStats({
        totalCustomers,
        newCustomers,
        totalBalance,
        totalAdded,
        totalUsed,
        pending,
        approved,
        rejected,
        totalOrders
      })
      // These two lists used to ALWAYS show the most recent 6 overall, no
      // matter which tab was selected - so switching to Today (or a
      // Custom Date) never actually narrowed what showed up here, only
      // the stat tiles above changed. That's exactly what made the ₹9
      // approval from 8:14 AM look "missing": it's real, it just wasn't
      // one of the 6 single most-recent requests across all of history,
      // even though it belonged to the selected day. Now these respect
      // the same period as everything else on the page.
      setRecentOrders(
        (recentOrdersRes.data || [])
          .filter((o) => isReal(o.user_id) && (!from || inRange(o.created_at)))
          .slice(0, 10)
      )
      setRecentFundRequests(
        (recentFundRes.data || [])
          .filter((r) => isReal(r.user_id) && (!from || inRange(r.created_at)))
          .slice(0, 10)
      )
      setLoading(false)
    }
    load()
    return () => {
      mounted = false
    }
  }, [filter, customFrom, customTo])

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
      <div className="row-between" style={{ marginBottom: filter === 'custom' ? 10 : 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 19, margin: 0 }}>Dashboard</h1>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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

      {filter === 'custom' && (
        <div className="surface-card" style={{ marginBottom: 16 }}>
          <div className="row-between" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Calendar size={15} className="text-gold" />
              <strong style={{ fontSize: 13.5 }}>Custom Date Range</strong>
            </div>
            {(customFrom || customTo) && (
              <button
                className="icon-btn"
                aria-label="Clear dates"
                onClick={() => {
                  setCustomFrom('')
                  setCustomTo('')
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
            <div style={{ flex: '1 1 140px' }}>
              <span className="field-label">From</span>
              <input type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} />
            </div>
            <div style={{ flex: '1 1 140px' }}>
              <span className="field-label">To</span>
              <input type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="chip" style={{ cursor: 'pointer', border: 'none' }} onClick={pickYesterday}>Yesterday</button>
            <button className="chip" style={{ cursor: 'pointer', border: 'none' }} onClick={() => pickLastNDays(7)}>Last 7 Days</button>
            <button className="chip" style={{ cursor: 'pointer', border: 'none' }} onClick={() => pickLastNDays(30)}>Last 30 Days</button>
          </div>

          {customFrom && customTo ? (
            <p className="text-faint" style={{ fontSize: 11.5, marginTop: 12, marginBottom: 0 }}>
              Showing {customFrom === customTo ? formatDateShort(customFrom) : `${formatDateShort(customFrom)} – ${formatDateShort(customTo)}`}
            </p>
          ) : (
            <p className="text-faint" style={{ fontSize: 11.5, marginTop: 12, marginBottom: 0 }}>Pick both dates, or use a shortcut above.</p>
          )}
        </div>
      )}

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
