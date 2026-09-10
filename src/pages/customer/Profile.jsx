import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Wallet as WalletIcon,
  PlusCircle,
  History,
  ReceiptText,
  LifeBuoy,
  Info,
  LogOut,
  Pencil,
  Check,
  X,
  BellRing,
  Download,
  ScrollText
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { usePushNotifications } from '../../hooks/usePushNotifications'
import { useInstallPrompt } from '../../context/InstallPromptContext'
import { initialsFromName, formatDateShort } from '../../utils/format'

const MENU = [
  { to: '/wallet', label: 'Wallet', icon: WalletIcon },
  { to: '/add-funds', label: 'Add Funds', icon: PlusCircle },
  { to: '/fund-history', label: 'Fund History', icon: History },
  { to: '/orders', label: 'My Orders', icon: ReceiptText },
  { to: '/support', label: 'Support', icon: LifeBuoy },
  { to: '/about', label: 'About Us', icon: Info },
  { to: '/terms', label: 'Terms & Conditions', icon: ScrollText }
]

export default function Profile() {
  const navigate = useNavigate()
  const { profile, user, signOut, refreshProfile } = useAuth()
  const { supported: pushSupported, subscribed, subscribing, subscribe, error: pushError } = usePushNotifications()
  const { canOfferInstall, installed, promptInstall } = useInstallPrompt()
  const [editing, setEditing] = useState(false)
  const [fullName, setFullName] = useState(profile?.full_name || '')
  const [username, setUsername] = useState(profile?.username || '')
  const [phone, setPhone] = useState(profile?.phone || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    setSaving(true)
    setError('')
    const { error: err } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), username: username.trim(), phone: phone.trim() || null })
      .eq('id', user.id)
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    await refreshProfile()
    setEditing(false)
  }

  return (
    <div className="page-pad">
      <div className="surface-card" style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <div className="avatar-circle" style={{ width: 56, height: 56, fontSize: 18 }}>
          {initialsFromName(profile?.full_name || profile?.username)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" style={{ marginBottom: 6 }} />
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" style={{ marginBottom: 6 }} />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile number (optional)" />
            </>
          ) : (
            <>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{profile?.full_name || 'Add your name'}</div>
              <div className="text-faint" style={{ fontSize: 12 }}>@{profile?.username}</div>
              <div className="text-faint" style={{ fontSize: 11.5 }}>{profile?.email}</div>
              <div className="text-faint" style={{ fontSize: 11.5 }}>{profile?.phone || 'No mobile number on file'}</div>
            </>
          )}
        </div>
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button className="icon-btn" onClick={handleSave} disabled={saving}>
              <Check size={16} />
            </button>
            <button className="icon-btn" onClick={() => setEditing(false)}>
              <X size={16} />
            </button>
          </div>
        ) : (
          <button className="icon-btn" onClick={() => setEditing(true)}>
            <Pencil size={15} />
          </button>
        )}
      </div>
      {error && <div className="field-error" style={{ marginTop: -10, marginBottom: 12 }}>{error}</div>}

      {profile?.created_at && (
        <p className="text-faint" style={{ fontSize: 11, marginTop: -10, marginBottom: 18 }}>
          Member since {formatDateShort(profile.created_at)}
        </p>
      )}

      {(pushSupported || (canOfferInstall && !installed)) && (
        <div className="surface-card" style={{ padding: 6, marginBottom: 14 }}>
          {pushSupported && (
            <button
              className="list-row"
              style={{ width: '100%', background: 'none', border: 'none' }}
              onClick={subscribe}
              disabled={subscribed || subscribing}
            >
              <BellRing size={17} />
              <span style={{ flex: 1, textAlign: 'left', fontSize: 13.5, fontWeight: 600 }}>
                {subscribed ? 'Notifications Enabled' : subscribing ? 'Enabling…' : 'Enable Notifications'}
              </span>
              {subscribed && <span className="chip chip-success">On</span>}
            </button>
          )}
          {canOfferInstall && !installed && (
            <button className="list-row" style={{ width: '100%', background: 'none', border: 'none' }} onClick={promptInstall}>
              <Download size={17} />
              <span style={{ flex: 1, textAlign: 'left', fontSize: 13.5, fontWeight: 600 }}>Add to Home Screen</span>
            </button>
          )}
        </div>
      )}
      {pushError && <div className="field-error" style={{ marginTop: -8, marginBottom: 12 }}>{pushError}</div>}

      <div className="surface-card" style={{ padding: 6 }}>
        {MENU.map((item) => (
          <button
            key={item.to}
            className="list-row"
            style={{ width: '100%', background: 'none', border: 'none' }}
            onClick={() => navigate(item.to)}
          >
            <item.icon size={17} />
            <span style={{ flex: 1, textAlign: 'left', fontSize: 13.5, fontWeight: 600 }}>{item.label}</span>
          </button>
        ))}
      </div>

      <button className="btn btn-secondary" style={{ marginTop: 18 }} onClick={() => signOut()}>
        <LogOut size={16} /> Logout
      </button>
    </div>
  )
}
