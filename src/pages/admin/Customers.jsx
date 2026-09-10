import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
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
  const [query, setQuery] = useState('')
  const [dateFilter, setDateFilter] = useState('all')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [profRes, walletRes, orderRes] = await Promise.all([
        supabase.from('profiles').select('*').order('created_at', { ascending: false }),
        supabase.from('wallets').select('*'),
        supabase.from('orders').select('user_id')
      ])
      setProfiles(profRes.data || [])
      setWallets(walletRes.data || [])
      const counts = {}
      for (const o of orderRes.data || []) {
        counts[o.user_id] = (counts[o.user_id] || 0) + 1
      }
      setOrderCounts(counts)
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
        (p) => p.username?.toLowerCase().includes(q) || p.full_name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q)
      )
    }
    if (dateFilter !== 'all') {
      const { from } = getRange(dateFilter)
      if (from) list = list.filter((p) => p.created_at >= from)
    }
    return list
  }, [profiles, query, dateFilter])

  if (loading) return <Loader />

  return (
    <div>
      <h1 style={{ fontSize: 19, margin: '0 0 16px' }}>Customers</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={15} style={{ position: 'absolute', left: 11, top: 12, color: 'var(--text-faint)' }} />
          <input placeholder="Search username, name, email..." value={query} onChange={(e) => setQuery(e.target.value)} style={{ paddingLeft: 34 }} />
        </div>
        <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} style={{ width: 'auto' }}>
          <option value="all">All Time</option>
          <option value="today">Today</option>
          <option value="week">This Week</option>
          <option value="month">This Month</option>
        </select>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="table-simple">
          <thead>
            <tr>
              <th>Username</th>
              <th>Name</th>
              <th>Email</th>
              <th>Registered</th>
              <th>Status</th>
              <th>Available Fund</th>
              <th>Orders</th>
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
                  <td>{formatDateShort(p.created_at)}</td>
                  <td><span className={`chip ${p.account_status === 'active' ? 'chip-success' : 'chip-danger'}`}>{p.account_status}</span></td>
                  <td>{formatCurrency(w?.available_fund || 0)}</td>
                  <td>{orderCounts[p.id] || 0}</td>
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
