import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Wallet as WalletIcon, Lock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Loader from '../../components/common/Loader'
import Modal from '../../components/common/Modal'
import { formatCurrency, formatDate, initialsFromName } from '../../utils/format'
import { useAuth } from '../../context/AuthContext'

export default function CustomerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isSuperAdmin } = useAuth()
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)
  const [wallet, setWallet] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [orders, setOrders] = useState([])
  const [referralsMade, setReferralsMade] = useState([])
  const [referredBy, setReferredBy] = useState(null)
  const [tab, setTab] = useState('overview')
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState({ action: 'add', amount: '', reason: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  async function load() {
    setLoading(true)
    const [profRes, walletRes, txRes, orderRes, referralsMadeRes, referredByRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', id).maybeSingle(),
      supabase.from('wallets').select('*').eq('user_id', id).maybeSingle(),
      supabase.from('wallet_transactions').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(50),
      supabase.from('orders').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(50),
      // Everyone THIS customer has referred (they're the referrer).
      supabase.from('referrals').select('*, referred:referred_id(username, email)').eq('referrer_id', id).order('created_at', { ascending: false }),
      // Who referred THIS customer, if anyone (they're the one referred).
      supabase.from('referrals').select('*, referrer:referrer_id(username, email)').eq('referred_id', id).maybeSingle()
    ])
    setProfile(profRes.data)
    setWallet(walletRes.data)
    setTransactions(txRes.data || [])
    setOrders(orderRes.data || [])
    setReferralsMade(referralsMadeRes.data || [])
    setReferredBy(referredByRes.data)
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (!successMsg) return
    const t = setTimeout(() => setSuccessMsg(''), 6000)
    return () => clearTimeout(t)
  }, [successMsg])

  async function toggleStatus() {
    const newStatus = profile.account_status === 'active' ? 'suspended' : 'active'
    await supabase.from('profiles').update({ account_status: newStatus }).eq('id', id)
    load()
  }

  async function toggleTestAccount() {
    await supabase.from('profiles').update({ is_test_account: !profile.is_test_account }).eq('id', id)
    load()
  }

  // Opens the modal AND resets the form back to defaults every time -
  // without this, if an admin had previously picked "Deduct Fund" or
  // "Set Balance To" for a different adjustment (even one they cancelled
  // out of without confirming), that selection silently stuck around the
  // next time they opened this same modal. Typing "50" meaning to ADD
  // funds while the dropdown was still quietly sitting on "Deduct" or
  // "Set Balance To" would actually deduct, or overwrite the balance -
  // this is very likely why a manual "add ₹50" didn't show up as +₹50.
  function openAdjustModal() {
    setForm({ action: 'add', amount: '', reason: '' })
    setError('')
    setSuccessMsg('')
    setModalOpen(true)
  }

  async function submitAdjustment() {
    setError('')
    if (!form.amount || Number(form.amount) < 0) {
      setError('Enter a valid amount.')
      return
    }
    if (!form.reason.trim()) {
      setError('A reason is required.')
      return
    }

    // Wallet changes move real money, so this gets the same "are you
    // sure?" popup that deleting a QR code / storage file already has -
    // everywhere else in the app that's destructive or money-related
    // asks first, this was the one gap.
    const previous = Number(wallet?.available_fund || 0)
    const next =
      form.action === 'add'
        ? previous + Number(form.amount)
        : form.action === 'deduct'
        ? previous - Number(form.amount)
        : Number(form.amount)
    const actionLabel = form.action === 'add' ? 'Add' : form.action === 'deduct' ? 'Deduct' : 'Set balance to'
    if (
      !window.confirm(
        `${actionLabel} ${formatCurrency(Number(form.amount))} for this customer?\n\nBalance: ${formatCurrency(previous)} → ${formatCurrency(next)}\nReason: ${form.reason.trim()}`
      )
    ) {
      return
    }

    setBusy(true)
    const { data, error: err } = await supabase.rpc('admin_adjust_wallet', {
      p_user_id: id,
      p_action: form.action,
      p_amount: Number(form.amount),
      p_reason: form.reason.trim()
    })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setModalOpen(false)
    setForm({ action: 'add', amount: '', reason: '' })
    // Confirms exactly what happened, in plain terms, so it's obvious the
    // change actually went through instead of the admin having to eyeball
    // the stat tile and wonder if it updated.
    setSuccessMsg(
      data
        ? `Done — balance is now ${formatCurrency(data.new_balance)} (was ${formatCurrency(data.previous_balance)}).`
        : 'Done — wallet updated.'
    )
    load()
  }

  if (loading || !profile) return <Loader />

  return (
    <div>
      <button className="icon-btn" style={{ marginBottom: 12 }} onClick={() => navigate('/admin/customers')}>
        <ArrowLeft size={16} />
      </button>

      <div className="surface-card" style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <div className="avatar-circle" style={{ width: 52, height: 52, fontSize: 16 }}>
          {initialsFromName(profile.full_name || profile.username)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{profile.full_name || '—'}</div>
          <div className="text-faint" style={{ fontSize: 12 }}>@{profile.username} · {profile.email}</div>
          <div className="text-faint" style={{ fontSize: 11 }}>Joined {formatDate(profile.created_at)}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <span className={`chip ${profile.account_status === 'active' ? 'chip-success' : 'chip-danger'}`} style={{ cursor: 'pointer' }} onClick={toggleStatus}>
            {profile.account_status}
          </span>
          <span
            className={`chip ${profile.is_test_account ? 'chip-warning' : ''}`}
            style={{ cursor: 'pointer', border: profile.is_test_account ? 'none' : '1px dashed var(--border)' }}
            onClick={toggleTestAccount}
            title="Test accounts are excluded from Dashboard and Reports totals"
          >
            {profile.is_test_account ? 'Test Account' : 'Mark as Test'}
          </span>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <div className="stat-label">Available Fund</div>
          <div className="stat-value text-gold">{formatCurrency(wallet?.available_fund || 0)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Added</div>
          <div className="stat-value text-success">{formatCurrency(wallet?.total_fund_added || 0)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Used</div>
          <div className="stat-value">{formatCurrency(wallet?.total_fund_used || 0)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Refunded</div>
          <div className="stat-value text-gold">{formatCurrency(wallet?.total_fund_refunded || 0)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Orders</div>
          <div className="stat-value">{orders.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">People Referred</div>
          <div className="stat-value text-gold">{referralsMade.length}</div>
        </div>
      </div>

      {profile.referral_code && (
        <p className="text-faint" style={{ fontSize: 11.5, marginBottom: 10 }}>
          Referral code: <strong className="text-dim">{profile.referral_code}</strong>
          {referredBy && (
            <>
              {' '}· Referred by <strong className="text-dim">{referredBy.referrer?.username || referredBy.referrer?.email || 'a deleted account'}</strong>
              {' '}<span className={`chip ${referredBy.status === 'paid' ? 'chip-success' : referredBy.status === 'rejected' ? 'chip-danger' : 'chip-warning'}`} style={{ marginLeft: 4 }}>
                {referredBy.status}
              </span>
            </>
          )}
        </p>
      )}

      {isSuperAdmin ? (
        <button className="btn btn-primary" style={{ marginBottom: 10 }} onClick={openAdjustModal}>
          <WalletIcon size={16} /> Modify Fund
        </button>
      ) : (
        <p className="text-faint" style={{ fontSize: 11.5, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Lock size={12} /> Only a Super Admin can modify a customer's wallet balance directly.
        </p>
      )}
      {successMsg && (
        <div className="text-success" style={{ fontSize: 12.5, marginBottom: 12, fontWeight: 600 }}>
          {successMsg}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {['overview', 'wallet', 'orders', 'referrals'].map((t) => (
          <button key={t} className={`chip ${tab === t ? 'chip-gold' : ''}`} style={{ border: 'none', cursor: 'pointer' }} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'wallet' && (
        <div className="surface-card">
          {transactions.length === 0 && <p className="text-faint" style={{ fontSize: 13 }}>No transactions yet.</p>}
          {transactions.map((tx) => (
            <div key={tx.id} className="list-row">
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{tx.type}</div>
                <div className="text-faint" style={{ fontSize: 11 }}>{formatDate(tx.created_at)} {tx.remark ? `· ${tx.remark}` : ''}</div>
              </div>
              <span style={{ fontWeight: 700 }}>{formatCurrency(tx.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'orders' && (
        <div className="surface-card">
          {orders.length === 0 && <p className="text-faint" style={{ fontSize: 13 }}>No orders yet.</p>}
          {orders.map((o) => (
            <div key={o.id} className="list-row">
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{o.order_code}</div>
                <div className="text-faint" style={{ fontSize: 11 }}>{o.category_name_snapshot} · {formatDate(o.created_at)}</div>
              </div>
              <span className="chip chip-info">{o.status}</span>
              <span style={{ fontWeight: 700 }}>{formatCurrency(o.grand_total)}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'referrals' && (
        <div className="surface-card">
          {referralsMade.length === 0 && <p className="text-faint" style={{ fontSize: 13 }}>Hasn't referred anyone yet.</p>}
          {referralsMade.map((r) => (
            <div key={r.id} className="list-row">
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{r.referred?.username || r.referred_email || '—'}</div>
                <div className="text-faint" style={{ fontSize: 11 }}>Joined {formatDate(r.created_at)}</div>
              </div>
              <span className={`chip ${r.status === 'paid' ? 'chip-success' : r.status === 'rejected' ? 'chip-danger' : 'chip-warning'}`}>{r.status}</span>
              {r.bonus_amount && <span style={{ fontWeight: 700 }}>{formatCurrency(r.bonus_amount)}</span>}
            </div>
          ))}
        </div>
      )}

      {tab === 'overview' && (
        <div className="surface-card">
          <p className="text-dim" style={{ fontSize: 13 }}>
            Registered on {formatDate(profile.created_at)}. Last activity {formatDate(profile.last_activity_at)}.
          </p>
        </div>
      )}

      {modalOpen && (
        <Modal title="Modify Fund" onClose={() => setModalOpen(false)}>
          <p className="text-dim" style={{ fontSize: 12.5, marginBottom: 10 }}>
            Current Balance: {formatCurrency(wallet?.available_fund || 0)}
          </p>
          <div style={{ marginBottom: 10 }}>
            <span className="field-label">Action</span>
            <select value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })}>
              <option value="add">Add Fund</option>
              <option value="deduct">Deduct Fund</option>
              <option value="set">Set Balance To</option>
            </select>
          </div>
          <div style={{ marginBottom: 10 }}>
            <span className="field-label">Amount</span>
            <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <span className="field-label">Reason (required)</span>
            <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
          {form.amount && (
            <p className="text-faint" style={{ fontSize: 11.5, marginBottom: 10 }}>
              Previous: {formatCurrency(wallet?.available_fund || 0)} → New:{' '}
              {formatCurrency(
                form.action === 'add'
                  ? Number(wallet?.available_fund || 0) + Number(form.amount)
                  : form.action === 'deduct'
                  ? Number(wallet?.available_fund || 0) - Number(form.amount)
                  : Number(form.amount)
              )}
            </p>
          )}
          {error && <div className="field-error" style={{ marginBottom: 10 }}>{error}</div>}
          <button className="btn btn-primary" onClick={submitAdjustment} disabled={busy}>
            {busy ? 'Saving…' : 'Confirm'}
          </button>
        </Modal>
      )}
    </div>
  )
}
