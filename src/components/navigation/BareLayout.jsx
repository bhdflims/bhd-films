import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import AnimatedBackground from '../common/AnimatedBackground'

// Used for full-screen flows without the bottom nav (Login, Payment QR,
// Order Success) but still with the app shell + background. Unlike
// AppLayout, these pages never had a header at all, so there was no back
// button and no clearance from the iOS status bar - add a minimal header
// bar (same back-button logic as TopHeader) that covers both.
export default function BareLayout() {
  const location = useLocation()
  const navigate = useNavigate()

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
    <div className="app-shell">
      <AnimatedBackground />
      <header className="bare-header">
        <button className="icon-btn" onClick={handleBack} aria-label="Back">
          <ChevronLeft size={21} />
        </button>
      </header>
      <main className="app-content no-nav">
        <Outlet />
      </main>
    </div>
  )
}
