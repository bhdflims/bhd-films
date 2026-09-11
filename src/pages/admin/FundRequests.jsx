import { useEffect, useState } from 'react'
import { Check, X, RotateCcw, Eye, ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Loader from '../../components/common/Loader'
import Modal from '../../components/common/Modal'
import { formatCurrency, formatDate } from '../../utils/format'
import { compressImage } from '../../utils/imageCompress'

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

  // "Record Payment for a Customer" - the fallback for when a
  // customer's own receipt upload keeps failing on their phone and they
  // send the admin the screenshot directly instead (see
  // admin_create_fund_request_for_customer). Kept entirely separate
  // from the review modal above.
  const [recordModalOpen, setRecordModalOpen] = useState(false)
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerOptions, setCustomerOptions] = useState([])
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [recordAmount, setRecordAmount] = useState('')
  const [recordNote, setRecordNote] = useState('')
  const [recordFile, setRecordFile] = useState(null)
  const [recordBusy, setRecordBusy] = useState(false)
  const [recordError, setRecordError] = useState('')

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

  function openRecordModal() {
    setCustomerQuery('')
    setCustomerOptions([])
    setSelectedCustomer(null)
    setRecordAmount('')
    setRecordNote('')
    setRecordFile(null)
    setRecordError('')
    setRecordModalOpen(true)
  }

  // Searches as the admin types - only once at least 2 characters are in,
  // so this doesn't fire on every keystroke of an empty box or fetch the
  // entire customer list up front.
  useEffect(() => {
    if (!recordModalOpen || selectedCustomer || customerQuery.trim().length < 2) {
      setCustomerOptions([])
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      const q = customerQuery.trim()
      const { data } = await supabase
        .from('profiles')
        .select('id, username, full_name, email, phone')
        .or(`username.ilike.%${q}%,full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`)
        .limit(10)
      if (!cancelled) setCustomerOptions(data || [])
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [customerQuery, recordModalOpen, selectedCustomer])

  async function submitRecordPayment() {
    setRecordError('')
    if (!selectedCustomer) {
      setRecordError('Please select which customer this payment is for.')
      return
    }
    if (!recordAmount || Number(recordAmount) <= 0) {
      setRecordError('Enter a valid amount.')
      return
    }
    if (!recordFile) {
      setRecordError('Please upload the payment screenshot.')
      return
    }
    setRecordBusy(true)
    try {
      const uploadFile = await compressImage(recordFile)
      const path = `${selectedCustomer.id}/${Date.now()}-admin-${uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { error: uploadError } = await supabase.storage.from('receipts').upload(path, uploadFile)
      if (uploadError) throw uploadError

      const { error: rpcError } = await supabase.rpc('admin_create_fund_request_for_customer', {
        p_user_id: selectedCustomer.id,
        p_amount: Number(recordAmount),
        p_receipt_path: path,
        p_note: recordNote.trim() || null
      })
      if (rpcError) throw rpcError

      setRecordModalOpen(false)
      load()
    } catch (e) {
      setRecordError(e.message || 'Could not record this payment. Please try again.')
    } finally {
      setRecordBusy(false)
    }
  }

  const visible = statusFilter === 'all' ? requests : requests.filter((r) => r.status === statusFilter)

  if (loading) return <Loader />

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 19, margin: 0 }}>Fund Requests</h1>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 'auto' }}>
          <option value="all">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
      </div>

      <button className="btn btn-secondary" style={{ marginBottom: 16 }} onClick={openRecordModal}>
        <ShieldCheck size={15} /> Record Payment for a Customer
      </button>
      <p className="text-faint" style={{ fontSize: 11, marginTop: -10, marginBottom: 16 }}>
        For when a customer's own receipt upload keeps failing - upload the screenshot they sent you and it goes
        into the queue below for approval, same as a normal request.
      </p>

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
                {r.submitted_by_admin_id && (
                  <div className="chip chip-warning" style={{ fontSize: 9.5, padding: '2px 6px', marginTop: 4, display: 'inline-flex' }}>
                    <ShieldCheck size={10} style={{ marginRight: 3 }} /> Recorded by admin
                  </div>
                )}
                {r.admin_submission_note && (
                  <div className="text-faint" style={{ fontSize: 11, marginTop: 4, fontStyle: 'italic' }}>"{r.admin_submission_note}"</div>
                )}
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

      {recordModalOpen && (
        <Modal title="Record Payment for a Customer" onClose={() => setRecordModalOpen(false)}>
          <p className="text-dim" style={{ fontSize: 12, marginBottom: 12 }}>
            Use this only when the customer already paid but their own receipt upload isn't working. Upload the
            screenshot they sent you - this creates a normal pending request that still needs approving below,
            it doesn't credit the wallet by itself.
          </p>

          {!selectedCustomer ? (
            <div style={{ marginBottom: 10 }}>
              <span className="field-label">Customer</span>
              <input
                value={customerQuery}
                onChange={(e) => setCustomerQuery(e.target.value)}
                placeholder="Search by username, name, email or phone..."
                autoFocus
              />
              {customerOptions.length > 0 && (
                <div className="surface-card" style={{ marginTop: 8, padding: 6 }}>
                  {customerOptions.map((c) => (
                    <div
                      key={c.id}
                      className="list-row"
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        setSelectedCustomer(c)
                        setCustomerOptions([])
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>@{c.username || c.email}</div>
                        <div className="text-faint" style={{ fontSize: 11 }}>{c.full_name || '—'} · {c.email}{c.phone ? ` · ${c.phone}` : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {customerQuery.trim().length >= 2 && customerOptions.length === 0 && (
                <p className="text-faint" style={{ fontSize: 11.5, marginTop: 6 }}>No matching customers.</p>
              )}
            </div>
          ) : (
            <div className="row-between surface-card" style={{ marginBottom: 10, padding: 10 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>@{selectedCustomer.username || selectedCustomer.email}</div>
                <div className="text-faint" style={{ fontSize: 11 }}>{selectedCustomer.full_name || '—'} · {selectedCustomer.email}</div>
              </div>
              <button className="icon-btn" onClick={() => setSelectedCustomer(null)}>
                <X size={13} />
              </button>
            </div>
          )}

          <div style={{ marginBottom: 10 }}>
            <span className="field-label">Amount Paid</span>
            <input type="number" value={recordAmount} onChange={(e) => setRecordAmount(e.target.value)} placeholder="e.g. 50" />
          </div>

          <div style={{ marginBottom: 10 }}>
            <span className="field-label">Payment Screenshot</span>
            <input type="file" accept="image/*" onChange={(e) => setRecordFile(e.target.files?.[0] || null)} />
            {recordFile && <p className="text-dim" style={{ fontSize: 11.5, marginTop: 6 }}>{recordFile.name}</p>}
          </div>

          <div style={{ marginBottom: 10 }}>
            <span className="field-label">Note (optional)</span>
            <input
              value={recordNote}
              onChange={(e) => setRecordNote(e.target.value)}
              placeholder="e.g. Customer's upload kept failing, sent this over WhatsApp"
            />
          </div>

          {recordError && <div className="field-error" style={{ marginBottom: 10 }}>{recordError}</div>}

          <button className="btn btn-primary" onClick={submitRecordPayment} disabled={recordBusy}>
            {recordBusy ? 'Submitting…' : 'Add to Fund Requests for Approval'}
          </button>
        </Modal>
      )}
    </div>
  )
}
