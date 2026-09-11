import { useEffect, useMemo, useState } from 'react'
import { Trash2, Lock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import Loader from '../../components/common/Loader'
import { formatCurrency } from '../../utils/format'

export default function PaymentSettings() {
  const { user, isSuperAdmin } = useAuth()
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState(null)
  const [qrCodes, setQrCodes] = useState([])
  const [presetsText, setPresetsText] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [qrFiles, setQrFiles] = useState({}) // key: amount or 'default' -> File
  const [qrBusy, setQrBusy] = useState(null) // amount or 'default' currently uploading/deleting
  const [qrMessage, setQrMessage] = useState('')

  async function load() {
    setLoading(true)
    const [settingsRes, qrRes] = await Promise.all([
      supabase.from('payment_settings').select('*').eq('id', true).maybeSingle(),
      supabase.from('payment_qr_codes').select('*').order('amount', { ascending: true, nullsFirst: false })
    ])
    setSettings(settingsRes.data)
    setPresetsText((settingsRes.data?.preset_amounts || []).join(', '))
    setQrCodes(qrRes.data || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleSave() {
    setSaving(true)
    setMessage('')

    const presetAmounts = presetsText
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => !Number.isNaN(v) && v > 0)

    const { error } = await supabase
      .from('payment_settings')
      .update({
        upi_id: settings.upi_id,
        instructions: settings.instructions,
        allow_custom_amount: settings.allow_custom_amount,
        preset_amounts: presetAmounts,
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

  // Build the list of rows to show: every current preset amount, every
  // amount that already has a QR saved (even if no longer a preset), plus
  // the special "default / fallback" row (amount = null) at the end.
  const amountRows = useMemo(() => {
    const presetAmounts = (settings?.preset_amounts || []).map(Number)
    const known = new Set(presetAmounts)
    qrCodes.forEach((q) => {
      if (q.amount !== null) known.add(Number(q.amount))
    })
    const rows = Array.from(known)
      .sort((a, b) => a - b)
      .map((amt) => ({
        key: String(amt),
        amount: amt,
        label: formatCurrency(amt),
        isPreset: presetAmounts.includes(amt),
        qr: qrCodes.find((q) => q.amount !== null && Number(q.amount) === amt) || null
      }))
    rows.push({
      key: 'default',
      amount: null,
      label: 'Default (custom amounts)',
      isPreset: true,
      qr: qrCodes.find((q) => q.amount === null) || null
    })
    return rows
  }, [settings, qrCodes])

  function qrPublicUrl(path) {
    if (!path) return null
    const { data } = supabase.storage.from('payment-qr').getPublicUrl(path)
    return data.publicUrl
  }

  async function handleUploadQr(row) {
    const file = qrFiles[row.key]
    if (!file) return
    setQrBusy(row.key)
    setQrMessage('')

    const path = `qr-${row.key}-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    const { error: uploadError } = await supabase.storage.from('payment-qr').upload(path, file, { upsert: true })
    if (uploadError) {
      setQrBusy(null)
      setQrMessage(uploadError.message)
      return
    }

    const query = row.qr
      ? supabase.from('payment_qr_codes').update({ qr_image_path: path, updated_by: user.id }).eq('id', row.qr.id)
      : supabase.from('payment_qr_codes').insert({ amount: row.amount, qr_image_path: path, updated_by: user.id })

    const { error: dbError } = await query
    setQrBusy(null)
    if (dbError) {
      setQrMessage(dbError.message)
      return
    }
    setQrFiles((prev) => {
      const next = { ...prev }
      delete next[row.key]
      return next
    })
    load()
  }

  async function handleDeleteQr(row) {
    if (!row.qr) return
    if (!window.confirm(`Remove the QR code for ${row.label}?`)) return
    setQrBusy(row.key)
    const { error } = await supabase.from('payment_qr_codes').delete().eq('id', row.qr.id)
    setQrBusy(null)
    if (error) {
      setQrMessage(error.message)
      return
    }
    load()
  }

  if (loading || !settings) return <Loader />

  return (
    <div style={{ maxWidth: 560 }}>
      <h1 style={{ fontSize: 19, margin: '0 0 16px' }}>Payment Settings</h1>

      <div style={{ marginBottom: 12 }}>
        <span className="field-label">UPI ID</span>
        <input value={settings.upi_id || ''} onChange={(e) => setSettings({ ...settings, upi_id: e.target.value })} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <span className="field-label">Instructions</span>
        <textarea rows={3} value={settings.instructions || ''} onChange={(e) => setSettings({ ...settings, instructions: e.target.value })} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <span className="field-label">Preset Amounts (comma separated)</span>
        <textarea rows={2} value={presetsText} onChange={(e) => setPresetsText(e.target.value)} />
        <p className="text-faint" style={{ fontSize: 11, marginTop: 4 }}>
          Save this list first, then scroll down to upload a QR code picture for each amount.
        </p>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <input
          type="checkbox"
          style={{ width: 18, height: 18 }}
          checked={settings.allow_custom_amount}
          onChange={(e) => setSettings({ ...settings, allow_custom_amount: e.target.checked })}
        />
        Allow customers to enter a custom amount
      </label>

      {message && <p className="text-dim" style={{ fontSize: 12.5, marginBottom: 10 }}>{message}</p>}
      <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save Settings'}
      </button>

      <h2 style={{ fontSize: 16, margin: '28px 0 6px' }}>QR Code Per Amount</h2>
      <p className="text-faint" style={{ fontSize: 11.5, marginTop: 0, marginBottom: 14 }}>
        Upload a separate QR code picture for each amount. Customers will see the exact QR that matches the amount
        they pick on the Add Funds screen.
      </p>

      <div className="surface-card">
        {qrMessage && <div className="field-error" style={{ marginBottom: 12 }}>{qrMessage}</div>}
        {amountRows.map((row) => {
          const currentUrl = qrPublicUrl(row.qr?.qr_image_path)
          return (
            <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border-soft)', padding: '12px 4px' }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 10,
                  background: '#fff',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden'
                }}
              >
                {currentUrl ? (
                  <img src={currentUrl} alt={row.label} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                ) : (
                  <span style={{ fontSize: 9, color: '#999', textAlign: 'center' }}>No QR</span>
                )}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>
                  {row.label}
                  {!row.isPreset && <span className="text-faint" style={{ fontWeight: 400, fontSize: 10.5 }}> · not a current preset</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  <input
                    type="file"
                    accept="image/*"
                    style={{ fontSize: 11, maxWidth: 170 }}
                    onChange={(e) =>
                      setQrFiles((prev) => ({ ...prev, [row.key]: e.target.files?.[0] || null }))
                    }
                  />
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={!qrFiles[row.key] || qrBusy === row.key}
                    onClick={() => handleUploadQr(row)}
                  >
                    {qrBusy === row.key ? 'Saving…' : row.qr ? 'Replace' : 'Upload'}
                  </button>
                  {row.qr && (isSuperAdmin ? (
                    <button className="icon-btn" disabled={qrBusy === row.key} onClick={() => handleDeleteQr(row)}>
                      <Trash2 size={14} />
                    </button>
                  ) : (
                    <span className="text-faint" title="Only a Super Admin can delete a QR code. Uploading a new one to replace it is still fine." style={{ display: 'flex', alignItems: 'center' }}>
                      <Lock size={13} />
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
