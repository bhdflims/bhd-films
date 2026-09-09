import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// Swaps the PWA manifest and app title between the customer app and the
// admin panel, based on which part of the site is currently open. Without
// this, "Add to Home Screen" always uses the one manifest referenced in
// index.html - so even from the admin login page, the installed icon would
// open the customer home screen instead. With this in place, adding to
// home screen from anywhere under /admin creates a SEPARATE icon (its own
// name, "BHD Films Admin") that opens straight into the admin panel.
export default function ManifestSwitcher() {
  const location = useLocation()

  useEffect(() => {
    const isAdminSection = location.pathname.startsWith('/admin')
    const manifestLink = document.getElementById('app-manifest')
    const appleTitle = document.getElementById('apple-title')

    if (manifestLink) {
      manifestLink.setAttribute('href', isAdminSection ? '/manifest-admin.webmanifest' : '/manifest.webmanifest')
    }
    if (appleTitle) {
      appleTitle.setAttribute('content', isAdminSection ? 'BHD Films Admin' : 'BHD Films')
    }
    document.title = isAdminSection ? 'BHD Films Admin' : 'BHD Films'
  }, [location.pathname])

  return null
}
