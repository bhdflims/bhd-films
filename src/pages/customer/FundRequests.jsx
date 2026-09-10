import { useEffect, useState } from 'react'
import { FileClock, Upload } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import Loader from '../../components/common/Loader'
import EmptyState from '../../components/common/EmptyState'
import { formatCurrency, formatDate } from '../../utils/format'
import { compressImage } from '../../utils/imageCompress'

const STATUS_CHIP = {
  pending: 'chip-info',
  under_review: 'chip-warning',
  approved: 'chip-success',
  rejected: 'chip-danger',
  reupload_required: 'chip-warning'
}

export default function FundRequests() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [requests, setRequests] = useState([])
  const [reuploadingId, setReuploadingId] = useState(null)
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('fund_requests')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
    setRequests(data || [])
    setLoading(false)
  }

  useEffect(() => {
    if (user) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function handleReupload(req) {
    setError('')
    if (!file) {
      setError('Please choose a file first.')
      return
    }
    setBusy(true)
    try {
      const uploadFile = await compressImage(file)
      const path = `${user.id}/${Date.now()}-${uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { error: uploadError } = await supabase.storage.from('receipts').upload(path, uploadFile)
      if (uploadError) throw uploadError

      const { error: rpcError } = await supabase.rpc('resubmit_fund_request', {
        p_fund_request_id: req.id,
        p_receipt_path: path
      })
      if (rpcError) throw rpcError

      setReuploadingId(null)
      setFile(null)
      await load()
    } catch (e) {
      setError(e.message || 'Could not re-upload. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Loader />

  return (
    <div className="page-pad">
      <h1 style={{ fontSize: 18, margin: '4px 0 16px' }}>Fund Requests</h1>

      {requests.length === 0 ? (
        <EmptyState icon={FileClock} title="No fund requests yet" subtitle="Requests you submit will appear here." />
      ) : (
        requests.map((r) => (
          <div key={r.id} className="surface-card" style={{ marginBottom: 10 }}>
            <div className="row-between">
              <div>
                <div style={{ fontWeight: 800, fontSize: 13.5 }}>{r.request_code}</div>
                <div className="text-faint" style={{ fontSize: 11 }}>{formatDate(r.created_at)} · Attempt {r.attempt_number}</div>
              </div>
              <span className={`chip ${STATUS_CHIP[r.status] || 'chip-info'}`}>{r.status.replace('_', ' ')}</span>
            </div>
            <div className="row-between" style={{ marginTop: 10 }}>
              <span className="text-faint" style={{ fontSize: 12 }}>Amount</span>
              <span style={{ fontWeight: 700 }}>{formatCurrency(r.amount)}</span>
            </div>
            {r.admin_remark && (
              <p className="text-dim" style={{ fontSize: 11.5, marginTop: 8 }}>Remark: {r.admin_remark}</p>
            )}

            {r.status === 'reupload_required' && (
              <div style={{ marginTop: 10 }}>
                {reuploadingId === r.id ? (
                  <>
                    <input type="file" accept="image/*,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                    {error && <div className="field-error">{error}</div>}
                    <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} disabled={busy} onClick={() => handleReupload(r)}>
                      <Upload size={14} /> {busy ? 'Uploading…' : 'Submit Re-upload'}
                    </button>
                  </>
                ) : (
                  <button className="btn btn-secondary btn-sm" onClick={() => setReuploadingId(r.id)}>
                    Re-upload Receipt
                  </button>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )
}
