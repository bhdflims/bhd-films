import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import Loader from '../../components/common/Loader'
import { formatDate } from '../../utils/format'

export default function MaintenanceMode() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('site_settings').select('*').eq('id', true).maybeSingle()
    setSettings(data)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleSave() {
    setSaving(true)
    setMessage('')
    const { error } = await supabase
      .from('site_settings')
      .update({
        maintenance_mode: settings.maintenance_mode,
        maintenance_message_en: settings.maintenance_message_en,
        maintenance_message_hi: settings.maintenance_message_hi,
        updated_by: user.id
      })
      .eq('id', true)
    setSaving(false)
    if (error) {
      setMessage(error.message)
      return
    }
    setMessage('Saved successfully.')
    load()
  }

  if (loading || !settings) return <Loader />

  return (
    <div style={{ maxWidth: 560 }}>
      <h1 style={{ fontSize: 19, margin: '0 0 6px' }}>Maintenance Mode</h1>
      <p className="text-faint" style={{ fontSize: 12, marginTop: 0, marginBottom: 18 }}>
        When turned ON, every customer — including people who aren't logged in — sees the message below
        instead of the app, on both the website and the home-screen app. The admin panel always stays
        reachable so you can keep working and switch it back off, and any order you process in Admin →
        Orders continues normally in the background either way.
      </p>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: 14,
          borderRadius: 12,
          border: '1px solid var(--border)',
          background: settings.maintenance_mode ? 'rgba(224, 67, 90, 0.14)' : 'var(--surface)',
          marginBottom: 18,
          cursor: 'pointer'
        }}
      >
        <input
          type="checkbox"
          style={{ width: 18, height: 18 }}
          checked={settings.maintenance_mode}
          onChange={(e) => setSettings({ ...settings, maintenance_mode: e.target.checked })}
        />
        <span style={{ fontWeight: 800, fontSize: 13.5 }}>
          {settings.maintenance_mode ? '🔴 Website is UNDER MAINTENANCE right now' : '🟢 Website is live'}
        </span>
      </label>

      <div style={{ marginBottom: 12 }}>
        <span className="field-label">Message shown to customers — English</span>
        <textarea
          rows={4}
          value={settings.maintenance_message_en || ''}
          onChange={(e) => setSettings({ ...settings, maintenance_message_en: e.target.value })}
        />
      </div>

      <div style={{ marginBottom: 18 }}>
        <span className="field-label">Message shown to customers — Hindi</span>
        <textarea
          rows={4}
          value={settings.maintenance_message_hi || ''}
          onChange={(e) => setSettings({ ...settings, maintenance_message_hi: e.target.value })}
        />
      </div>

      {message && <p className="text-dim" style={{ fontSize: 12.5, marginBottom: 10 }}>{message}</p>}
      <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>

      {settings.updated_at && (
        <p className="text-faint" style={{ fontSize: 11, marginTop: 14 }}>
          Last changed {formatDate(settings.updated_at)}
        </p>
      )}
    </div>
  )
}
