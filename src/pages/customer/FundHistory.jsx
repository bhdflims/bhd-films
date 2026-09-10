import { useEffect, useId, useState } from 'react'
import { History } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import Loader from '../../components/common/Loader'
import EmptyState from '../../components/common/EmptyState'
import { formatCurrency, formatDate } from '../../utils/format'

const TYPE_LABEL = {
  fund_added: 'Fund Added',
  fund_used: 'Fund Used',
  adjustment: 'Adjustment',
  refund: 'Refund'
}

const TYPE_CHIP = {
  fund_added: 'chip-success',
  fund_used: 'chip-info',
  adjustment: 'chip-warning',
  refund: 'chip-gold'
}

export default function FundHistory() {
  const { user } = useAuth()
  const instanceId = useId()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState([])

  useEffect(() => {
    let mounted = true
    async function load() {
      const { data } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (!mounted) return
      setRows(data || [])
      setLoading(false)
    }
    if (user) load()
    return () => {
      mounted = false
    }
  }, [user])

  // New transactions (fund added, order payment, refund, adjustment)
  // appear here the instant they happen, without needing a refresh.
  useEffect(() => {
    if (!user) return undefined
    const channel = supabase
      .channel(`fund-history-${user.id}-${instanceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wallet_transactions', filter: `user_id=eq.${user.id}` }, () => {
        supabase
          .from('wallet_transactions')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .then(({ data }) => setRows(data || []))
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, instanceId])

  if (loading) return <Loader />

  return (
    <div className="page-pad">
      <h1 style={{ fontSize: 18, margin: '4px 0 16px' }}>Fund History</h1>

      {rows.length === 0 ? (
        <EmptyState icon={History} title="No transactions yet" />
      ) : (
        rows.map((tx) => (
          <div key={tx.id} className="surface-card" style={{ marginBottom: 10 }}>
            <div className="row-between">
              <span className={`chip ${TYPE_CHIP[tx.type] || 'chip-info'}`}>{TYPE_LABEL[tx.type] || tx.type}</span>
              <span style={{ fontWeight: 800, color: tx.type === 'fund_used' ? 'var(--danger)' : 'var(--success)' }}>
                {tx.type === 'fund_used' ? '-' : '+'}
                {formatCurrency(tx.amount)}
              </span>
            </div>
            <div className="text-faint" style={{ fontSize: 11, marginTop: 6 }}>{formatDate(tx.created_at)}</div>
            {tx.remark && <div className="text-dim" style={{ fontSize: 11.5, marginTop: 6 }}>{tx.remark}</div>}
            <div className="row-between" style={{ fontSize: 11, marginTop: 8 }}>
              <span className="text-faint">Balance before: {formatCurrency(tx.balance_before)}</span>
              <span className="text-faint">Balance after: {formatCurrency(tx.balance_after)}</span>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
