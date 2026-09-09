import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// Swaps the PWA manifest, home-screen icon, and app title between the
// customer app and the admin panel, based on which part of the site is
// currently open. Without this, "Add to Home Screen" always uses whatever
// is hardcoded in index.html - so even from the admin login page, the
// installed icon would look like and open the customer app instead. With
// this in place, adding to home screen from anywhere under /admin creates a
// SEPARATE icon (its own red "A" picture and its own name, "BHD Films
// Admin") that opens straight into the admin panel.
//
// IMPORTANT: iOS Safari's "Add to Home Screen" picks the icon picture from
// the <link rel="apple-touch-icon"> tag, NOT from the manifest's icons
// list. So the apple-touch-icon href has to be swapped here too, or the
// added icon keeps showing the customer logo even while the manifest and
// title are already correctly pointing at the admin panel.
export default function ManifestSwitcher() {
  const location = useLocation()

  useEffect(() => {
    const isAdminSection = location.pathname.startsWith('/admin')
    const manifestLink = document.getElementById('app-manifest')
    const appleTitle = document.getElementById('apple-title')
    const appleTouchIcon = document.getElementById('apple-touch-icon')

    if (manifestLink) {
      manifestLink.setAttribute('href', isAdminSection ? '/manifest-admin.webmanifest' : '/manifest.webmanifest')
    }
    if (appleTitle) {
      appleTitle.setAttribute('content', isAdminSection ? 'BHD Films Admin' : 'BHD Films')
    }
    if (appleTouchIcon) {
      appleTouchIcon.setAttribute('href', isAdminSection ? '/icons/apple-touch-icon-admin.png' : '/icons/apple-touch-icon.png')
    }
    document.title = isAdminSection ? 'BHD Films Admin' : 'BHD Films'
  }, [location.pathname])

  return null
}
