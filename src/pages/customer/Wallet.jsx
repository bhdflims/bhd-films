import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PlusCircle, History, FileClock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useWallet } from '../../hooks/useWallet'
import Loader from '../../components/common/Loader'
import { formatCurrency } from '../../utils/format'

export default function Wallet() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { wallet, loading } = useWallet()
  const [counts, setCounts] = useState({ pending: 0, rejected: 0 })

  useEffect(() => {
    if (!user) return
    supabase
      .from('fund_requests')
      .select('status')
      .eq('user_id', user.id)
      .then(({ data }) => {
        const rows = data || []
        setCounts({
          pending: rows.filter((r) => ['pending', 'under_review', 'reupload_required'].includes(r.status)).length,
          rejected: rows.filter((r) => r.status === 'rejected').length
        })
      })
  }, [user])

  if (loading || !wallet) return <Loader />

  return (
    <div className="page-pad">
      <h1 style={{ fontSize: 18, margin: '4px 0 16px' }}>Wallet</h1>

      <div className="surface-card" style={{ textAlign: 'center', marginBottom: 14 }}>
        <p className="text-faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 4px' }}>
          Available Fund
        </p>
        <p style={{ fontSize: 30, fontWeight: 800, margin: 0 }} className="text-gold">
          {formatCurrency(wallet.available_fund)}
        </p>
      </div>

      <div className="grid-3" style={{ marginBottom: 14 }}>
        <div className="stat-card">
          <div className="stat-label">Total Added</div>
          <div className="stat-value text-success">{formatCurrency(wallet.total_fund_added)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Used</div>
          <div className="stat-value">{formatCurrency(wallet.total_fund_used)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Refunded</div>
          <div className="stat-value text-gold">{formatCurrency(wallet.total_fund_refunded)}</div>
        </div>
      </div>

      <button className="list-row" style={{ width: '100%', background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', marginBottom: 10 }} onClick={() => navigate('/fund-requests')}>
        <FileClock size={17} />
        <span style={{ flex: 1, textAlign: 'left', fontSize: 13.5, fontWeight: 600 }}>Pending Fund Requests</span>
        <span className="chip chip-warning">{counts.pending}</span>
      </button>
      <button className="list-row" style={{ width: '100%', background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', marginBottom: 18 }} onClick={() => navigate('/fund-requests')}>
        <FileClock size={17} />
        <span style={{ flex: 1, textAlign: 'left', fontSize: 13.5, fontWeight: 600 }}>Rejected Fund Requests</span>
        <span className="chip chip-danger">{counts.rejected}</span>
      </button>

      <button className="btn btn-primary" style={{ marginBottom: 10 }} onClick={() => navigate('/add-funds')}>
        <PlusCircle size={16} /> Add Funds
      </button>
      <button className="btn btn-secondary" onClick={() => navigate('/fund-history')}>
        <History size={16} /> Fund History
      </button>
    </div>
  )
}
