import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { Search, FileSpreadsheet } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Loader from '../../components/common/Loader'
import { formatCurrency, formatDateShort } from '../../utils/format'
import { getRange } from '../../utils/dateRanges'

export default function Customers() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [profiles, setProfiles] = useState([])
  const [wallets, setWallets] = useState([])
  const [orderCounts, setOrderCounts] = useState({})
  const [orderSpend, setOrderSpend] = useState({})
  const [referralCounts, setReferralCounts] = useState({})
  const [query, setQuery] = useState('')
  const [dateFilter, setDateFilter] = useState('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [profRes, walletRes, orderRes, referralRes] = await Promise.all([
        supabase.from('profiles').select('*').order('created_at', { ascending: false }),
        supabase.from('wallets').select('*'),
        supabase.from('orders').select('user_id, grand_total, discount_amount'),
        supabase.from('referrals').select('referrer_id')
      ])
      setProfiles(profRes.data || [])
      setWallets(walletRes.data || [])
      const counts = {}
      const spend = {}
      for (const o of orderRes.data || []) {
        counts[o.user_id] = (counts[o.user_id] || 0) + 1
        spend[o.user_id] = (spend[o.user_id] || 0) + (Number(o.grand_total) - Number(o.discount_amount || 0))
      }
      setOrderCounts(counts)
      setOrderSpend(spend)
      const refCounts = {}
      for (const r of referralRes.data || []) {
        refCounts[r.referrer_id] = (refCounts[r.referrer_id] || 0) + 1
      }
      setReferralCounts(refCounts)
      setLoading(false)
    }
    load()
  }, [])

  const walletByUser = useMemo(() => {
    const map = {}
    for (const w of wallets) map[w.user_id] = w
    return map
  }, [wallets])

  const filtered = useMemo(() => {
    let list = profiles
    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter(
        (p) =>
          p.username?.toLowerCase().includes(q) ||
          p.full_name?.toLowerCase().includes(q) ||
          p.email?.toLowerCase().includes(q) ||
          p.phone?.includes(q)
      )
    }
    if (dateFilter === 'custom') {
      if (customFrom && customTo) {
        const { from, to } = getRange('custom', customFrom, customTo)
        list = list.filter((p) => p.created_at >= from && p.created_at <= to)
      }
    } else if (dateFilter !== 'all') {
      const { from } = getRange(dateFilter)
      if (from) list = list.filter((p) => p.created_at >= from)
    }
    return list
  }, [profiles, query, dateFilter, customFrom, customTo])

  // Builds a real .xlsx file (opens directly in Excel/Google Sheets/Numbers)
  // from exactly what's currently visible on screen - so if the admin has
  // searched or date-filtered the list, the export matches it. Every
  // column an admin would want for a customer report is included: who
  // they are, how to reach them, what's in their wallet right now, how
  // much they've added/spent overall, and how many orders they've placed.
  function handleExportExcel() {
    const rows = filtered.map((p) => {
      const w = walletByUser[p.id]
      return {
        Username: p.username || '',
        'Full Name': p.full_name || '',
        Email: p.email || '',
        Phone: p.phone || '',
        Registered: formatDateShort(p.created_at),
        Status: p.account_status,
        'Test Account': p.is_test_account ? 'Yes' : 'No',
        'Wallet Balance (₹)': Number(w?.available_fund || 0),
        'Total Fund Added (₹)': Number(w?.total_fund_added || 0),
        'Total Order Spend (₹)': Number(orderSpend[p.id] || 0),
        'Total Orders': orderCounts[p.id] || 0,
        'Referral Code': p.referral_code || '',
        'People Referred': referralCounts[p.id] || 0
      }
    })

    const ws = XLSX.utils.json_to_sheet(rows)
    // Reasonable column widths so it doesn't open all-squished.
    ws['!cols'] = [
      { wch: 16 }, { wch: 20 }, { wch: 26 }, { wch: 14 }, { wch: 12 },
      { wch: 10 }, { wch: 12 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 12 },
      { wch: 14 }, { wch: 14 }
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Customers')

    const label = dateFilter === 'all' ? 'all-time' : dateFilter === 'custom' ? `${customFrom}_to_${customTo}` : dateFilter
    XLSX.writeFile(wb, `bhd-films-customers-${label}-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 19, margin: 0 }}>Customers</h1>
        <button className="btn btn-secondary btn-sm" onClick={handleExportExcel} disabled={filtered.length === 0}>
          <FileSpreadsheet size={15} /> Export Excel ({filtered.length})
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={15} style={{ position: 'absolute', left: 11, top: 12, color: 'var(--text-faint)' }} />
          <input placeholder="Search username, name, email, phone..." value={query} onChange={(e) => setQuery(e.target.value)} style={{ paddingLeft: 34 }} />
        </div>
        <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} style={{ width: 'auto' }}>
          <option value="all">All Time</option>
          <option value="today">Today</option>
          <option value="week">This Week</option>
          <option value="month">This Month</option>
          <option value="custom">Custom Range</option>
        </select>
      </div>

      {dateFilter === 'custom' && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 160px' }}>
            <span className="field-label">From</span>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <span className="field-label">To</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table className="table-simple">
          <thead>
            <tr>
              <th>Username</th>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Registered</th>
              <th>Status</th>
              <th>Wallet Balance</th>
              <th>Total Spent</th>
              <th>Orders</th>
              <th>Referrals</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const w = walletByUser[p.id]
              return (
                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/admin/customers/${p.id}`)}>
                  <td>
                    @{p.username}
                    {p.is_test_account && (
                      <span className="chip chip-warning" style={{ marginLeft: 6, fontSize: 9, padding: '2px 6px' }}>TEST</span>
                    )}
                  </td>
                  <td>{p.full_name || '—'}</td>
                  <td>{p.email}</td>
                  <td>{p.phone || '—'}</td>
                  <td>{formatDateShort(p.created_at)}</td>
                  <td><span className={`chip ${p.account_status === 'active' ? 'chip-success' : 'chip-danger'}`}>{p.account_status}</span></td>
                  <td>{formatCurrency(w?.available_fund || 0)}</td>
                  <td>{formatCurrency(orderSpend[p.id] || 0)}</td>
                  <td>{orderCounts[p.id] || 0}</td>
                  <td>{referralCounts[p.id] ? <span className="chip chip-gold">{referralCounts[p.id]}</span> : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="text-faint" style={{ fontSize: 13, marginTop: 10 }}>No customers found.</p>}
      </div>
    </div>
  )
}
