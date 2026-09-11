import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Menu,
  X,
  ChevronLeft,
  LayoutGrid,
  Wallet,
  PlusCircle,
  History,
  ReceiptText,
  LifeBuoy,
  Info,
  FileText,
  LogIn,
  LogOut,
  User,
  Download,
  BellRing
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useWallet } from '../../hooks/useWallet'
import { useInstallPrompt } from '../../context/InstallPromptContext'
import { usePushNotifications } from '../../hooks/usePushNotifications'
import { formatCurrency, initialsFromName } from '../../utils/format'
import NotificationBell from '../common/NotificationBell'

const DRAWER_LINKS = [
  { to: '/services', label: 'All Services', icon: LayoutGrid },
  { to: '/wallet', label: 'Wallet', icon: Wallet },
  { to: '/add-funds', label: 'Add Funds', icon: PlusCircle },
  { to: '/fund-history', label: 'Fund History', icon: History },
  { to: '/orders', label: 'Order History', icon: ReceiptText },
  { to: '/support', label: 'Support', icon: LifeBuoy },
  { to: '/about', label: 'About Us', icon: Info },
  { to: '/terms', label: 'Terms & Conditions', icon: FileText }
]

// The 5 bottom-nav destinations - the only places where "hamburger menu"
// (rather than "go back") is the right icon, since there's nowhere more
// shallow to go back to; you just tap another tab instead.
const ROOT_TAB_PATHS = ['/', '/offers', '/orders', '/wallet', '/profile']

export default function TopHeader() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isLoggedIn, profile, signOut } = useAuth()
  const { wallet } = useWallet()
  const { canOfferInstall, installed, promptInstall } = useInstallPrompt()
  const { supported: pushSupported, subscribed, subscribing, subscribe } = usePushNotifications()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [brandName, setBrandName] = useState(null)

  useEffect(() => {
    // Brand Details (admin, super_admin only) lets the header
    // name/wordmark be changed without a code push - falls back to the
    // original "BHD FILMS" split styling if nothing's been set.
    supabase
      .from('brand_settings')
      .select('brand_name_primary, brand_name_accent')
      .eq('id', true)
      .maybeSingle()
      .then(({ data }) => setBrandName(data))
  }, [])

  // Every other screen (Add Funds, Fund Requests/History, a category's
  // order page, Support, About, Terms, a profile edit...) was only ever
  // reachable through the hamburger drawer or a button elsewhere in the
  // app - once there, there was no way back except the phone's own back
  // gesture (easy to miss, and on iOS standalone PWA mode there often
  // isn't one at all), so people got stuck or accidentally backed out of
  // the whole app. Show a real back arrow there instead.
  const isRootTab = ROOT_TAB_PATHS.includes(location.pathname)

  function go(to) {
    setDrawerOpen(false)
    navigate(to)
  }

  function handleBack() {
    // location.key is 'default' only when this page was the very first
    // thing loaded in this tab/PWA session (typed URL, bookmark, deep
    // link) - there's no in-app history to go back to, so send them
    // somewhere real (Home) instead of navigate(-1) taking them out of
    // the app entirely.
    if (location.key && location.key !== 'default') {
      navigate(-1)
    } else {
      navigate('/')
    }
  }

  return (
    <>
      <header className="top-header">
        {isRootTab ? (
          <button className="icon-btn" onClick={() => setDrawerOpen(true)} aria-label="Menu">
            <Menu size={19} />
          </button>
        ) : (
          <button className="icon-btn" onClick={handleBack} aria-label="Back">
            <ChevronLeft size={21} />
          </button>
        )}

        <div className="brand-wordmark" onClick={() => navigate('/')} role="button" tabIndex={0}>
          {brandName?.brand_name_primary?.trim() || 'BHD'}{' '}
          <span className="text-gold">{brandName?.brand_name_accent?.trim() || 'FILMS'}</span>
        </div>

        {isLoggedIn ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <NotificationBell />
            <button className="avatar-circle avatar-btn" onClick={() => navigate('/profile')} aria-label="Profile">
              {initialsFromName(profile?.full_name || profile?.username)}
            </button>
          </div>
        ) : (
          <button className="icon-btn" onClick={() => navigate('/login')} aria-label="Login">
            <User size={18} />
          </button>
        )}
      </header>

      {drawerOpen && (
        <div className="modal-backdrop" onClick={() => setDrawerOpen(false)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="row-between" style={{ marginBottom: 14 }}>
              <strong style={{ fontSize: 15 }}>Menu</strong>
              <button className="icon-btn" onClick={() => setDrawerOpen(false)}>
                <X size={16} />
              </button>
            </div>

            {isLoggedIn && wallet && (
              <button
                className="row-between"
                style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, marginBottom: 12 }}
                onClick={() => go('/wallet')}
              >
                <span className="text-faint" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Wallet size={14} /> Available Fund
                </span>
                <span className="text-gold" style={{ fontWeight: 800, fontSize: 15 }}>
                  {formatCurrency(wallet.available_fund)}
                </span>
              </button>
            )}

            {DRAWER_LINKS.map((item) => (
              <button
                key={item.to}
                className="list-row"
                style={{ width: '100%', background: 'none', border: 'none' }}
                onClick={() => go(item.to)}
              >
                <item.icon size={17} />
                <span style={{ flex: 1, textAlign: 'left', fontSize: 13.5, fontWeight: 600 }}>{item.label}</span>
              </button>
            ))}

            {canOfferInstall && !installed && (
              <button
                className="list-row"
                style={{ width: '100%', background: 'none', border: 'none' }}
                onClick={() => {
                  setDrawerOpen(false)
                  promptInstall()
                }}
              >
                <Download size={17} />
                <span style={{ flex: 1, textAlign: 'left', fontSize: 13.5, fontWeight: 600 }}>Add to Home Screen</span>
              </button>
            )}

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
              </button>
            )}

            <div className="divider" />

            {isLoggedIn ? (
              <button className="btn btn-secondary" onClick={() => { setDrawerOpen(false); signOut() }}>
                <LogOut size={16} /> Logout
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => go('/login')}>
                <LogIn size={16} /> Login
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
