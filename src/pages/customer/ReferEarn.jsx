import { useEffect, useState } from 'react'
import { Share2, Copy, Check, Gift } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import Loader from '../../components/common/Loader'
import EmptyState from '../../components/common/EmptyState'
import { formatCurrency, formatDateShort } from '../../utils/format'

const STATUS_LABEL = {
  pending: 'Waiting',
  qualified: 'Almost There',
  paid: 'Bonus Paid',
  rejected: 'Not Approved'
}
const STATUS_CHIP = {
  pending: 'chip-warning',
  qualified: 'chip-info',
  paid: 'chip-success',
  rejected: 'chip-danger'
}

export default function ReferEarn() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState(null)
  const [referrals, setReferrals] = useState([])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let mounted = true
    async function load() {
      const [settingsRes, referralsRes] = await Promise.all([
        supabase.from('referral_settings').select('*').eq('id', true).maybeSingle(),
        supabase.from('referrals').select('*').eq('referrer_id', profile.id).order('created_at', { ascending: false })
      ])
      if (!mounted) return
      setSettings(settingsRes.data)
      setReferrals(referralsRes.data || [])
      setLoading(false)
    }
    if (profile) load()
    return () => {
      mounted = false
    }
  }, [profile])

  if (loading || !profile) return <Loader />

  const link = `${window.location.origin}/?ref=${profile.referral_code || ''}`
  const paidCount = referrals.filter((r) => r.status === 'paid').length
  const pendingCount = referrals.filter((r) => r.status === 'pending').length
  const totalEarned = referrals.reduce((s, r) => (r.status === 'paid' ? s + Number(r.bonus_amount || 0) : s), 0)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API can be unavailable (older browser, no permission) -
      // the link is still shown on screen and can be selected manually.
    }
  }

  const whatsappText = encodeURIComponent(
    `Join BHD Films and get social media growth services at great rates! Sign up using my link: ${link}`
  )

  return (
    <div className="page-pad">
      <div style={{ textAlign: 'center', margin: '20px 0 24px' }}>
        <div
          style={{
            width: 56,
            height: 56,
            margin: '0 auto 12px',
            borderRadius: 16,
            background: 'linear-gradient(135deg,var(--gold),var(--crimson))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Gift size={26} color="#170f08" />
        </div>
        <h1 style={{ fontSize: 19, margin: '0 0 4px' }}>Refer &amp; Earn</h1>
        <p className="text-faint" style={{ fontSize: 12 }}>Invite friends, earn wallet bonuses</p>
      </div>

      {settings && !settings.is_enabled && (
        <div className="surface-card" style={{ marginBottom: 14 }}>
          <p className="text-faint" style={{ fontSize: 12.5, margin: 0 }}>
            The referral program is temporarily paused by the admin. You can still share your link below, but new
            bonuses won't be paid out until it's switched back on.
          </p>
        </div>
      )}

      {/* ---------------- Your code / link ---------------- */}
      <div className="surface-card" style={{ marginBottom: 14, textAlign: 'center' }}>
        <p className="text-faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 6px' }}>
          Your Referral Code
        </p>
        <p style={{ fontSize: 26, fontWeight: 800, letterSpacing: 2, margin: '0 0 14px' }} className="text-gold">
          {profile.referral_code || '—'}
        </p>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
            border: '1px solid var(--border)', borderRadius: 10, marginBottom: 10
          }}
        >
          <span className="text-dim" style={{ fontSize: 11.5, flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {link}
          </span>
          <button className="btn btn-primary" style={{ padding: '6px 10px', fontSize: 12, flexShrink: 0 }} onClick={handleCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
        <a
          href={`https://wa.me/?text=${whatsappText}`}
          target="_blank"
          rel="noreferrer"
          className="btn btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
        >
          <Share2 size={14} /> Share on WhatsApp
        </a>
      </div>

      {/* ---------------- Stats ---------------- */}
      <div className="grid-3" style={{ marginBottom: 14 }}>
        <div className="stat-card">
          <div className="stat-label">Waiting</div>
          <div className="stat-value">{pendingCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Bonuses Paid</div>
          <div className="stat-value text-success">{paidCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Earned</div>
          <div className="stat-value text-gold">{formatCurrency(totalEarned)}</div>
        </div>
      </div>

      {/* ---------------- Rules ---------------- */}
      {settings && (
        <div className="surface-card" style={{ marginBottom: 16 }}>
          <strong style={{ fontSize: 13.5 }}>How it works</strong>
          <p className="text-dim" style={{ fontSize: 12.5, lineHeight: 1.6, margin: '8px 0 0' }}>
            Share your code or link with a friend who hasn't used BHD Films before. Once they sign up, add at least{' '}
            <strong>{formatCurrency(settings.min_fund_added)}</strong> to their wallet, and place orders totaling at
            least <strong>{formatCurrency(settings.min_order_amount)}</strong>, you'll automatically get{' '}
            <strong className="text-gold">{formatCurrency(settings.bonus_amount)}</strong> credited to your own
            wallet — no need to ask, it happens on its own.
          </p>
        </div>
      )}

      {/* ---------------- Your referrals ---------------- */}
      <h2 style={{ fontSize: 15, margin: '0 0 10px' }}>Your Referrals</h2>
      {referrals.length === 0 ? (
        <EmptyState icon={Gift} title="No referrals yet" subtitle="Share your link above to get started" />
      ) : (
        referrals.map((r) => (
          <div key={r.id} className="surface-card" style={{ marginBottom: 10 }}>
            <div className="row-between">
              <span className="text-dim" style={{ fontSize: 13, fontWeight: 600 }}>{r.referred_email || 'A referred customer'}</span>
              <span className={`chip ${STATUS_CHIP[r.status] || 'chip-info'}`}>{STATUS_LABEL[r.status] || r.status}</span>
            </div>
            <div className="text-faint" style={{ fontSize: 11, marginTop: 6 }}>Joined {formatDateShort(r.created_at)}</div>
            {r.status === 'paid' && (
              <div className="text-success" style={{ fontSize: 12, marginTop: 6, fontWeight: 700 }}>
                +{formatCurrency(r.bonus_amount)} credited {r.paid_at ? `on ${formatDateShort(r.paid_at)}` : ''}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}
