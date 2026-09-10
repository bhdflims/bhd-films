import { useEffect, useState } from 'react'
import { Check, X, RotateCcw, Eye } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Loader from '../../components/common/Loader'
import Modal from '../../components/common/Modal'
import { formatCurrency, formatDate } from '../../utils/format'

const STATUSES = ['pending', 'under_review', 'approved', 'rejected', 'reupload_required']

export default function AdminFundRequests() {
  const [loading, setLoading] = useState(true)
  const [requests, setRequests] = useState([])
  const [statusFilter, setStatusFilter] = useState('pending')
  const [actionModal, setActionModal] = useState(null) // { request, action }
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [receiptModal, setReceiptModal] = useState(null)
  const [receiptUrls, setReceiptUrls] = useState([])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('fund_requests')
      .select('*, profiles:user_id(username, email), fund_request_receipts(*)')
      .order('created_at', { ascending: false })
      .limit(300)
    setRequests(data || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('admin-fund-requests-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fund_requests' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  function openAction(request, action) {
    setActionModal({ request, action })
    setRemark(action === 'approve' ? 'Fund has been successfully added to your wallet.' : '')
    setError('')
  }

  async function submitAction() {
    if (!actionModal) return
    setBusy(true)
    setError('')
    const { error: err } = await supabase.rpc('admin_review_fund_request', {
      p_fund_request_id: actionModal.request.id,
      p_action: actionModal.action,
      p_remark: remark || null
    })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setActionModal(null)
    load()
  }

  async function openReceipts(request) {
    setReceiptModal(request)
    const urls = []
    for (const r of request.fund_request_receipts || []) {
      const { data } = await supabase.storage.from('receipts').createSignedUrl(r.storage_path, 300)
      if (data?.signedUrl) urls.push({ url: data.signedUrl, attempt: r.attempt_number })
    }
    setReceiptUrls(urls)
  }

  const visible = statusFilter === 'all' ? requests : requests.filter((r) => r.status === statusFilter)

  if (loading) return <Loader />

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 19, margin: 0 }}>Fund Requests</h1>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 'auto' }}>
          <option value="all">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
      </div>

      <div className="surface-card">
        {visible.length === 0 && <p className="text-faint" style={{ fontSize: 13 }}>No fund requests found.</p>}
        {visible.map((r) => (
          <div key={r.id} style={{ borderBottom: '1px solid var(--border-soft)', padding: '12px 4px' }}>
            <div className="row-between">
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{r.request_code}</div>
                <div className="text-faint" style={{ fontSize: 11 }}>
                  {r.profiles?.username || r.profiles?.email} · {formatDate(r.created_at)} · Attempt {r.attempt_number}
                </div>
              </div>
              <span style={{ fontWeight: 700 }}>{formatCurrency(r.amount)}</span>
            </div>
            <div className="row-between" style={{ marginTop: 8 }}>
              <span className="chip chip-info">{r.status.replace('_', ' ')}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="icon-btn" onClick={() => openReceipts(r)}>
                  <Eye size={14} />
                </button>
                {['pending', 'under_review'].includes(r.status) && (
                  <>
                    <button className="icon-btn" onClick={() => openAction(r, 'approve')}>
                      <Check size={14} color="var(--success)" />
                    </button>
                    <button className="icon-btn" onClick={() => openAction(r, 'reupload')}>
                      <RotateCcw size={14} color="var(--warning)" />
                    </button>
                    <button className="icon-btn" onClick={() => openAction(r, 'reject')}>
                      <X size={14} color="var(--danger)" />
                    </button>
                  </>
                )}
              </div>
            </div>
            {r.admin_remark && <p className="text-faint" style={{ fontSize: 11, marginTop: 6 }}>Remark: {r.admin_remark}</p>}
          </div>
        ))}
      </div>

      {actionModal && (
        <Modal
          title={actionModal.action === 'approve' ? 'Approve Fund Request' : actionModal.action === 'reject' ? 'Reject Fund Request' : 'Request Re-upload'}
          onClose={() => setActionModal(null)}
        >
          <p className="text-dim" style={{ fontSize: 12.5, marginBottom: 10 }}>
            {actionModal.request.request_code} · {formatCurrency(actionModal.request.amount)}
          </p>
          <span className="field-label">Remark</span>
          <textarea rows={3} value={remark} onChange={(e) => setRemark(e.target.value)} />
          {error && <div className="field-error" style={{ marginTop: 8 }}>{error}</div>}
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={submitAction} disabled={busy}>
            {busy ? 'Submitting…' : 'Confirm'}
          </button>
        </Modal>
      )}

      {receiptModal && (
        <Modal title={`Receipts · ${receiptModal.request_code}`} onClose={() => setReceiptModal(null)}>
          {receiptUrls.length === 0 && <p className="text-faint" style={{ fontSize: 12.5 }}>Loading…</p>}
          {receiptUrls.map((r, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <p className="text-faint" style={{ fontSize: 11 }}>Attempt {r.attempt}</p>
              <a href={r.url} target="_blank" rel="noreferrer">
                <img src={r.url} alt="receipt" style={{ width: '100%', borderRadius: 12, border: '1px solid var(--border)' }} />
              </a>
            </div>
          ))}
        </Modal>
      )}
    </div>
  )
}
