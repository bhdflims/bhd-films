import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import {
  LayoutDashboard,
  Users,
  FolderTree,
  Boxes,
  Percent,
  Layers,
  ShoppingBag,
  Banknote,
  History,
  QrCode,
  Gift,
  Tag,
  MessageSquare,
  BarChart3,
  ShieldCheck,
  UserCog,
  LogOut,
  Menu,
  Clapperboard,
  BellRing,
  Undo2,
  X,
  AlertTriangle,
  RefreshCw,
  HardDrive,
  Sparkles,
  Share2
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { usePushNotifications } from '../../hooks/usePushNotifications'
import AdminNotificationBell from '../../components/common/AdminNotificationBell'

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true, perm: null },
  { to: '/admin/customers', label: 'Customers', icon: Users, perm: 'view_customers' },
  { to: '/admin/categories', label: 'Categories', icon: FolderTree, perm: 'manage_categories' },
  { to: '/admin/services', label: 'Services', icon: Boxes, perm: 'manage_services' },
  { to: '/admin/rate-control', label: 'Rate Control', icon: Percent, perm: 'manage_rates' },
  { to: '/admin/bulk-pricing', label: 'Bulk Pricing', icon: Layers, perm: 'manage_bulk_pricing' },
  { to: '/admin/orders', label: 'Orders', icon: ShoppingBag, perm: 'manage_orders', unreadKey: 'orders' },
  { to: '/admin/fund-requests', label: 'Fund Requests', icon: Banknote, perm: 'manage_fund_requests', unreadKey: 'funds' },
  { to: '/admin/refunds', label: 'Refunds', icon: Undo2, perm: 'manage_refunds', unreadKey: 'refunds' },
  { to: '/admin/wallet-transactions', label: 'Wallet Transactions', icon: History, perm: 'manage_wallets' },
  { to: '/admin/payment-settings', label: 'Payment Settings', icon: QrCode, perm: 'manage_payment_settings' },
  { to: '/admin/maintenance-mode', label: 'Maintenance Mode', icon: AlertTriangle, perm: 'manage_payment_settings' },
  { to: '/admin/storage-cleanup', label: 'Storage Cleanup', icon: HardDrive, perm: 'manage_storage' },
  { to: '/admin/offers', label: 'Offers', icon: Gift, perm: 'manage_offers' },
  { to: '/admin/coupons', label: 'Coupons', icon: Tag, perm: 'manage_coupons' },
  { to: '/admin/support', label: 'Support Tickets', icon: MessageSquare, perm: 'manage_support', unreadKey: 'support' },
  { to: '/admin/reports', label: 'Reports', icon: BarChart3, perm: 'view_customers' },
  { to: '/admin/audit-log', label: 'Audit Log', icon: ShieldCheck, perm: 'view_audit_log' },
  { to: '/admin/admins', label: 'Admin Users', icon: UserCog, perm: 'manage_admins' },
  // 'manage_admins' is reused here purely as the "super_admin only" gate
  // (admin/staff are always blocked from it - see the allowed() and
  // has_permission() checks) - Brand Details itself has nothing to do
  // with managing admin accounts.
  { to: '/admin/brand-details', label: 'Brand Details', icon: Sparkles, perm: 'manage_admins' },
  { to: '/admin/referral-settings', label: 'Referral Settings', icon: Share2, perm: 'manage_admins' }
]

export default function AdminLayout() {
  const { adminRole, adminPermissions, signOut } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [unreadSupport, setUnreadSupport] = useState(0)
  const [unreadOrders, setUnreadOrders] = useState(0)
  const [unreadRefunds, setUnreadRefunds] = useState(0)
  const [unreadFunds, setUnreadFunds] = useState(0)
  const { supported: pushSupported, subscribed: pushSubscribed, subscribing: pushSubscribing, subscribe: pushSubscribe } = usePushNotifications()

  useEffect(() => {
    async function loadUnread() {
      const { count } = await supabase
        .from('support_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('has_unread_customer_message', true)
      setUnreadSupport(count || 0)
    }
    loadUnread()
    const channel = supabase
      .channel('admin-support-unread-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, loadUnread)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  // New orders badge — counts orders still sitting at "received" (just
  // paid, not yet picked up by an admin). Once an admin moves the status
  // forward (processing/completed/etc.) it drops off this count.
  useEffect(() => {
    async function loadNewOrders() {
      const { count } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'received')
      setUnreadOrders(count || 0)
    }
    loadNewOrders()
    const channel = supabase
      .channel('admin-orders-unread-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, loadNewOrders)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  // New refund requests badge — counts requests still "pending".
  useEffect(() => {
    async function loadPendingRefunds() {
      const { count } = await supabase
        .from('refund_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
      setUnreadRefunds(count || 0)
    }
    loadPendingRefunds()
    const channel = supabase
      .channel('admin-refunds-unread-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'refund_requests' }, loadPendingRefunds)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  // New fund-request badge — counts requests still "pending" or
  // "under_review" (the two states that need admin action), same idea
  // as the Orders/Refunds badges above.
  useEffect(() => {
    async function loadPendingFunds() {
      const { count } = await supabase
        .from('fund_requests')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'under_review'])
      setUnreadFunds(count || 0)
    }
    loadPendingFunds()
    const channel = supabase
      .channel('admin-fund-requests-unread-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fund_requests' }, loadPendingFunds)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  function allowed(perm) {
    if (!perm) return true
    if (adminRole === 'super_admin') return true
    if (adminRole === 'admin') return perm !== 'manage_admins'
    const restricted = ['manage_wallets', 'manage_rates', 'manage_bulk_pricing', 'manage_payment_settings', 'manage_admins', 'manage_refunds', 'manage_storage']
    if (restricted.includes(perm)) return false
    return !!adminPermissions?.[perm]
  }

  const visibleNav = NAV.filter((item) => allowed(item.perm))

  const badgeCounts = { support: unreadSupport, orders: unreadOrders, refunds: unreadRefunds, funds: unreadFunds }

  const linkList = (
    <>
      {visibleNav.map((item) => {
        const badgeCount = badgeCounts[item.unreadKey] || 0
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}
            onClick={() => setMobileOpen(false)}
          >
            <item.icon size={16} />
            {item.label}
            {badgeCount > 0 && (
              <span
                style={{
                  marginLeft: 'auto',
                  background: 'var(--crimson, #e0435a)',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 800,
                  borderRadius: 8,
                  padding: '1px 6px'
                }}
              >
                {badgeCount}
              </span>
            )}
          </NavLink>
        )
      })}
    </>
  )

  const notifyButton = pushSupported && (
    <button
      className="admin-nav-link"
      style={{ width: '100%', background: 'none', border: 'none' }}
      onClick={pushSubscribe}
      disabled={pushSubscribed || pushSubscribing}
    >
      <BellRing size={16} />
      {pushSubscribed ? 'Notifications Enabled' : pushSubscribing ? 'Enabling…' : 'Enable Notifications'}
    </button>
  )

  return (
    <div className="admin-shell">
      <div className="admin-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}>
          <Clapperboard size={18} /> BHD Films Admin
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="icon-btn" onClick={() => window.location.reload()} aria-label="Refresh">
            <RefreshCw size={17} />
          </button>
          <AdminNotificationBell />
          <button className="icon-btn" onClick={() => setMobileOpen(true)} aria-label="Menu">
            <Menu size={18} />
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="modal-backdrop" onClick={() => setMobileOpen(false)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="row-between" style={{ marginBottom: 14 }}>
              <strong>Menu</strong>
              <button className="icon-btn" onClick={() => setMobileOpen(false)}>
                <X size={16} />
              </button>
            </div>
            {linkList}
            <div className="divider" />
            {notifyButton}
            <div className="divider" />
            <button className="btn btn-secondary" onClick={() => signOut().then(() => navigate('/admin/login'))}>
              <LogOut size={16} /> Logout
            </button>
          </div>
        </div>
      )}

      <aside className="admin-sidebar">
        <div className="row-between" style={{ padding: '6px 10px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800 }}>
            <Clapperboard size={18} /> BHD Films
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button className="icon-btn" onClick={() => window.location.reload()} aria-label="Refresh">
              <RefreshCw size={16} />
            </button>
            <AdminNotificationBell />
          </div>
        </div>
        {linkList}
        <div className="divider" />
        {notifyButton}
        <button className="admin-nav-link" style={{ width: '100%', background: 'none', border: 'none' }} onClick={() => signOut().then(() => navigate('/admin/login'))}>
          <LogOut size={16} /> Logout
        </button>
        <p className="text-faint" style={{ fontSize: 10.5, padding: '10px 12px 0' }}>Role: {adminRole}</p>
      </aside>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  )
}
