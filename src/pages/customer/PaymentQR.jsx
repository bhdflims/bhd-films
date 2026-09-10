import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { QrCode, Upload, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { formatCurrency } from '../../utils/format'
import { compressImage } from '../../utils/imageCompress'

export default function PaymentQR() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const amount = location.state?.amount

  const [settings, setSettings] = useState(null)
  const [qrUrl, setQrUrl] = useState(null)
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!amount) {
      navigate('/add-funds', { replace: true })
      return
    }
    let cancelled = false

    async function load() {
      const [settingsRes, exactRes] = await Promise.all([
        supabase.from('payment_settings').select('*').eq('id', true).maybeSingle(),
        supabase.from('payment_qr_codes').select('qr_image_path').eq('amount', amount).maybeSingle()
      ])
      if (cancelled) return
      setSettings(settingsRes.data)

      // Prefer the QR uploaded specifically for this amount. If none exists,
      // fall back to the admin's default/fallback QR (amount = null), and
      // finally to the old single settings QR for backward compatibility.
      let qrPath = exactRes.data?.qr_image_path
      if (!qrPath) {
        const { data: fallback } = await supabase
          .from('payment_qr_codes')
          .select('qr_image_path')
          .is('amount', null)
          .maybeSingle()
        qrPath = fallback?.qr_image_path
      }
      if (!qrPath) qrPath = settingsRes.data?.qr_image_path
      if (cancelled) return
      if (qrPath) {
        const { data: pub } = supabase.storage.from('payment-qr').getPublicUrl(qrPath)
        setQrUrl(pub.publicUrl)
      } else {
        setQrUrl(null)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [amount, navigate])

  async function handleSubmit() {
    setError('')
    if (!file) {
      setError('Please upload your payment receipt.')
      return
    }
    setUploading(true)
    try {
      const uploadFile = await compressImage(file)
      const path = `${user.id}/${Date.now()}-${uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { error: uploadError } = await supabase.storage.from('receipts').upload(path, uploadFile)
      if (uploadError) throw uploadError

      const { error: rpcError } = await supabase.rpc('create_fund_request', {
        p_amount: amount,
        p_receipt_path: path
      })
      if (rpcError) throw rpcError

      setDone(true)
    } catch (e) {
      setError(e.message || 'Could not submit your request. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  if (done) {
    return (
      <div className="page-pad" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '80dvh', justifyContent: 'center', textAlign: 'center' }}>
        <CheckCircle2 size={52} color="var(--success)" />
        <h2 style={{ fontSize: 17, margin: '16px 0 6px' }}>Submitted for Verification</h2>
        <p className="text-dim" style={{ fontSize: 13 }}>
          Your payment has been submitted for verification. Our team will review it, typically within approximately
          5–10 minutes.
        </p>
        <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={() => navigate('/fund-requests')}>
          View Fund Requests
        </button>
        <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => navigate('/')}>
          Back to Home
        </button>
      </div>
    )
  }

  return (
    <div className="page-pad">
      <h1 style={{ fontSize: 18, margin: '4px 0 16px' }}>Complete Payment</h1>

      <div className="surface-card" style={{ textAlign: 'center' }}>
        <p className="text-faint" style={{ fontSize: 11, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: 1 }}>
          Amount to Pay
        </p>
        <p style={{ fontSize: 26, fontWeight: 800, margin: '0 0 16px' }} className="text-gold">
          {formatCurrency(amount)}
        </p>

        <div
          style={{
            width: 190,
            height: 190,
            margin: '0 auto',
            borderRadius: 16,
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden'
          }}
        >
          {qrUrl ? (
            <img src={qrUrl} alt="Payment QR" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <QrCode size={90} color="#111" />
          )}
        </div>

        {settings?.upi_id && <p className="text-dim" style={{ fontSize: 12.5, marginTop: 12 }}>UPI ID: {settings.upi_id}</p>}
        <p className="text-faint" style={{ fontSize: 11.5, marginTop: 8 }}>
          {settings?.instructions || 'Scan the QR code and pay the exact amount shown, then upload your payment screenshot below.'}
        </p>
      </div>

      <div style={{ marginTop: 18 }}>
        <span className="field-label">Upload Payment Receipt</span>
        <input type="file" accept="image/*,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        {file && <p className="text-dim" style={{ fontSize: 11.5, marginTop: 6 }}>{file.name}</p>}
        {error && <div className="field-error">{error}</div>}
      </div>

      <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={handleSubmit} disabled={uploading}>
        <Upload size={16} /> {uploading ? 'Submitting…' : 'Submit'}
      </button>
    </div>
  )
}
