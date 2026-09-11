import { Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import Loader from './Loader'

// Money/critical-access permissions no admin can hand out to staff, no
// matter what their permissions checkbox says - must exactly match the
// v_restricted list inside has_permission() in Postgres (the REAL
// enforcement) and the `restricted` array in AdminLayout.jsx's own
// allowed() check, which decides what shows up in the sidebar.
const ALWAYS_RESTRICTED = ['manage_wallets', 'manage_rates', 'manage_bulk_pricing', 'manage_payment_settings', 'manage_admins', 'manage_refunds']

// Wraps every /admin/* page, optionally with a required `permission`
// (see the `perm` field on each entry in AdminLayout.jsx's NAV array -
// pass that same value here for the matching route). Frontend gating is
// only a convenience so a staff member can't even load a page they have
// no business seeing by typing its URL directly (the sidebar already
// hides the link, but hiding a link doesn't stop direct navigation) -
// the REAL enforcement happens in Postgres RLS + has_permission(), so
// even if someone bypasses this component entirely they still can't
// read/write anything they're not allowed to.
export default function AdminRoute({ children, permission }) {
  const { isLoggedIn, isAdmin, adminRole, adminPermissions, loading } = useAuth()

  if (loading) return <Loader />
  if (!isLoggedIn || !isAdmin) {
    return <Navigate to="/admin/login" replace />
  }
  if (permission && !isAllowed(permission, adminRole, adminPermissions)) {
    return <Navigate to="/admin" replace />
  }
  return children
}

function isAllowed(permission, adminRole, adminPermissions) {
  if (adminRole === 'super_admin') return true
  if (adminRole === 'admin') return permission !== 'manage_admins'
  // staff: never the always-restricted set, otherwise only what was
  // explicitly checked for them in Admin Users.
  if (ALWAYS_RESTRICTED.includes(permission)) return false
  return !!adminPermissions?.[permission]
}
