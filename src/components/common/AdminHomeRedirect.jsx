import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

// Admin accounts in this app are strictly separate from customer accounts
// - they're never meant to sit on the customer-facing pages. Without this,
// an admin who ends up on a customer page while already logged in (e.g. a
// phone's home-screen icon that happens to open to "/" instead of
// "/admin", or a browser tab/bookmark pointing at the main site) would
// just see the customer app with no obvious sign anything is wrong - the
// exact "the admin app behaves like the customer app" problem this fixes.
// This runs on every navigation and, the moment it sees a logged-in admin
// sitting outside /admin, sends them straight there.
export default function AdminHomeRedirect() {
  const { isLoggedIn, isAdmin, loading } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (loading) return
    if (!isLoggedIn || !isAdmin) return
    if (location.pathname.startsWith('/admin')) return
    navigate('/admin', { replace: true })
  }, [loading, isLoggedIn, isAdmin, location.pathname, navigate])

  return null
}
