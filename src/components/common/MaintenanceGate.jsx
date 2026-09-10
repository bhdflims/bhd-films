import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Clapperboard } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// Sits just above <Routes>. When the admin has turned maintenance mode on,
// every customer route (logged in or not) shows a bilingual "back soon"
// screen instead of the real app. /admin/* is always exempt, so an admin
// can log in and switch it back off. Subscribes to live updates so an open
// tab flips over/back automatically without needing a manual refresh.
export default function MaintenanceGate({ children }) {
  const location = useLocation()
  const [settings, setSettings] = useState(null) // null = not loaded yet
  const isAdminRoute = location.pathname.startsWith('/admin')

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data } = await supabase.from('site_settings').select('*').eq('id', true).maybeSingle()
      if (!cancelled) setSettings(data)
    }

    load()

    const channel = supabase
      .channel('maintenance-gate')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'site_settings' }, load)
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [])

  // Admin panel is always reachable, maintenance mode or not.
  if (isAdminRoute) return children

  // First load, setting not fetched yet - render nothing rather than
  // flashing the real app for a moment before swapping to maintenance.
  if (settings === null) return null

  if (!settings.maintenance_mode) return children

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 20,
        padding: 'calc(env(safe-area-inset-top, 0px) + 28px) 24px calc(env(safe-area-inset-bottom, 0px) + 28px)',
        background: '#08070c',
        color: '#f5f3f0'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 20 }}>
        <Clapperboard size={24} /> BHD <span style={{ color: '#d4af37' }}>FILMS</span>
      </div>

      <p style={{ maxWidth: 420, fontSize: 15.5, lineHeight: 1.65, whiteSpace: 'pre-wrap', margin: 0 }}>
        {settings.maintenance_message_en}
      </p>

      <div style={{ width: 56, height: 1, background: 'rgba(245, 243, 240, 0.18)' }} />

      <p style={{ maxWidth: 420, fontSize: 15.5, lineHeight: 1.65, whiteSpace: 'pre-wrap', margin: 0 }}>
        {settings.maintenance_message_hi}
      </p>
    </div>
  )
}
