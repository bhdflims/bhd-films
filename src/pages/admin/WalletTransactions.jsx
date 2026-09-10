import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import Loader from '../../components/common/Loader'
import { formatCurrency, formatDate } from '../../utils/format'

const TYPES = ['fund_added', 'fund_used', 'adjustment', 'refund']

export default function WalletTransactions() {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])
  const [typeFilter, setTypeFilter] = useState('all')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('wallet_transactions')
        .select('*, profiles:user_id(username, email)')
        .order('created_at', { ascending: false })
        .limit(300)
      setRows(data || [])
      setLoading(false)
    }
    load()
    const channel = supabase
      .channel('admin-wallet-transactions-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wallet_transactions' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const visible = typeFilter === 'all' ? rows : rows.filter((r) => r.type === typeFilter)

  if (loading) return <Loader />

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 19, margin: 0 }}>Wallet Transactions</h1>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ width: 'auto' }}>
          <option value="all">All Types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="table-simple">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Before</th>
              <th>After</th>
              <th>Remark</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((tx) => (
              <tr key={tx.id}>
                <td>{tx.profiles?.username || tx.profiles?.email}</td>
                <td>{tx.type}</td>
                <td>{formatCurrency(tx.amount)}</td>
                <td>{formatCurrency(tx.balance_before)}</td>
                <td>{formatCurrency(tx.balance_after)}</td>
                <td style={{ whiteSpace: 'normal', maxWidth: 220 }}>{tx.remark}</td>
                <td>{formatDate(tx.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && <p className="text-faint" style={{ fontSize: 13, marginTop: 10 }}>No transactions found.</p>}
      </div>
    </div>
  )
}
