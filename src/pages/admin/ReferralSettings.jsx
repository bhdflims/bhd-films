import { useEffect, useState } from 'react'
import { Gift } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import Loader from '../../components/common/Loader'
import { formatCurrency, formatDate, formatDateShort } from '../../utils/format'

const STATUS_LABEL = { pending: 'Waiting', qualified: 'Qualified', paid: 'Bonus Paid' }
const STATUS_CHIP = { pending: 'chip-warning', qualified: 'chip-info', paid: 'chip-success' }

export default function ReferralSettings() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [referrals, setReferrals] = useState([])

  async function load() {
    setLoading(true)
    const [settingsRes, referralsRes] = await Promise.all([
      supabase.from('referral_settings').select('*').eq('id', true).maybeSingle(),
      supabase
        .from('referrals')
        .select('*, referrer:referrer_id(username, email)')
        .order('created_at', { ascending: false })
        .limit(200)
    ])
    setSettings(settingsRes.data)
    setReferrals(referralsRes.data || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleSave() {
    setSaving(true)
    setMessage('')
    const { error } = await supabase
      .from('referral_settings')
      .update({
        is_enabled: settings.is_enabled,
        min_fund_added: Number(settings.min_fund_added) || 0,
        min_order_amount: Number(settings.min_order_amount) || 0,
        bonus_amount: Number(settings.bonus_amount) || 0,
        updated_by: user.id
      })
      .eq('id', true)
    setSaving(false)
    if (error) {
      setMessage(error.message)
      return
    }
    setMessage('Saved — the new rule applies to referrals that qualify from now on.')
    load()
  }

  if (loading || !settings) return <Loader />

  const paidCount = referrals.filter((r) => r.status === 'paid').length
  const totalPaidOut = referrals.reduce((s, r) => (r.status === 'paid' ? s + Number(r.bonus_amount || 0) : s), 0)

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 19, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Gift size={19} /> Referral Settings
      </h1>
      <p className="text-faint" style={{ fontSize: 12, marginTop: 0, marginBottom: 18 }}>
        Control the "Refer & Earn" program: when a referral counts, and how much the referrer gets. Only applies to
        customers who sign up from now on — it does not look back at existing customers.
      </p>

      <label
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: 14, borderRadius: 12,
          border: '1px solid var(--border)',
          background: settings.is_enabled ? 'rgba(52, 211, 153, 0.12)' : 'var(--surface)',
          marginBottom: 16, cursor: 'pointer'
        }}
      >
        <input
          type="checkbox"
          style={{ width: 18, height: 18 }}
          checked={settings.is_enabled}
          onChange={(e) => setSettings({ ...settings, is_enabled: e.target.checked })}
        />
        <span style={{ fontWeight: 800, fontSize: 13.5 }}>
          {settings.is_enabled ? '🟢 Referral program is ON' : '🔴 Referral program is OFF'}
        </span>
      </label>

      <div className="surface-card" style={{ marginBottom: 16 }}>
        <strong style={{ fontSize: 13.5 }}>Qualifying Rule</strong>
        <p className="text-faint" style={{ fontSize: 11.5, margin: '6px 0 14px' }}>
          A referred customer must reach BOTH totals below (added up since they signed up, not a single transaction)
          before their referrer gets paid.
        </p>
        <div style={{ marginBottom: 12 }}>
          <span className="field-label">Minimum fund added (₹) — "Y"</span>
          <input
            type="number"
            min="0"
            step="1"
            value={settings.min_fund_added}
            onChange={(e) => setSettings({ ...settings, min_fund_added: e.target.value })}
          />
        </div>
        <div>
          <span className="field-label">Minimum order value placed (₹) — "X"</span>
          <input
            type="number"
            min="0"
            step="1"
            value={settings.min_order_amount}
            onChange={(e) => setSettings({ ...settings, min_order_amount: e.target.value })}
          />
        </div>
      </div>

      <div className="surface-card" style={{ marginBottom: 16 }}>
        <strong style={{ fontSize: 13.5 }}>Bonus Amount</strong>
        <p className="text-faint" style={{ fontSize: 11.5, margin: '6px 0 10px' }}>
          Credited automatically to the REFERRER's wallet the moment the rule above is met — "Z".
        </p>
        <div>
          <span className="field-label">Bonus (₹)</span>
          <input
            type="number"
            min="0"
            step="1"
            value={settings.bonus_amount}
            onChange={(e) => setSettings({ ...settings, bonus_amount: e.target.value })}
          />
        </div>
      </div>

      {message && <p className="text-dim" style={{ fontSize: 12.5, marginBottom: 10 }}>{message}</p>}
      <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>

      {settings.updated_at && (
        <p className="text-faint" style={{ fontSize: 11, marginTop: 14, marginBottom: 26 }}>
          Last changed {formatDate(settings.updated_at)}
        </p>
      )}

      <div className="grid-3" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <div className="stat-label">Total Referrals</div>
          <div className="stat-value">{referrals.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Bonuses Paid</div>
          <div className="stat-value text-success">{paidCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Paid Out</div>
          <div className="stat-value text-gold">{formatCurrency(totalPaidOut)}</div>
        </div>
      </div>

      <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>Referral Activity</h2>
      <div style={{ overflowX: 'auto' }}>
        <table className="table-simple">
          <thead>
            <tr>
              <th>Referrer</th>
              <th>Referred</th>
              <th>Status</th>
              <th>Bonus</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {referrals.map((r) => (
              <tr key={r.id}>
                <td>{r.referrer?.username || r.referrer?.email || '—'}</td>
                <td>{r.referred_email || '—'}</td>
                <td><span className={`chip ${STATUS_CHIP[r.status] || 'chip-info'}`}>{STATUS_LABEL[r.status] || r.status}</span></td>
                <td>{r.bonus_amount ? formatCurrency(r.bonus_amount) : '—'}</td>
                <td>{formatDateShort(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {referrals.length === 0 && <p className="text-faint" style={{ fontSize: 13, marginTop: 10 }}>No referral activity yet.</p>}
      </div>
    </div>
  )
}
