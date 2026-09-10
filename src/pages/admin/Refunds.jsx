import { useEffect, useState } from 'react'
import { Check, X, Wallet, Landmark } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Loader from '../../components/common/Loader'
import Modal from '../../components/common/Modal'
import { formatCurrency, formatDate } from '../../utils/format'

const STATUSES = ['pending', 'approved', 'rejected']

export default function Refunds() {
  const [loading, setLoading] = useState(true)
  const [requests, setRequests] = useState([])
  const [statusFilter, setStatusFilter] = useState('pending')
  const [actionModal, setActionModal] = useState(null) // { request, action }
  const [remark, setRemark] = useState('')
  const [deliveredQty, setDeliveredQty] = useState('')
  const [resolutionMethod, setResolutionMethod] = useState('wallet')
  const [refundAmount, setRefundAmount] = useState('')
  const [receiptFile, setReceiptFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [receiptModal, setReceiptModal] = useState(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('refund_requests')
      .select('*, profiles:user_id(username, email), orders:order_id(order_code, status, order_items(service_name_snapshot, quantity))')
      .order('created_at', { ascending: false })
      .limit(300)
    setRequests(data || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function openAction(request, action) {
    setActionModal({ request, action })
    setRemark(action === 'approve' ? 'Refund has been added to your wallet.' : '')
    setDeliveredQty('')
    setResolutionMethod('wallet')
    setRefundAmount(String(request.amount))
    setReceiptFile(null)
    setError('')
  }

  function orderedQty(request) {
    return request.ordered_quantity ?? (request.orders?.order_items || []).reduce((s, i) => s + (i.quantity || 0), 0)
  }

  function eligibilityHint(request) {
    const ordered = orderedQty(request)
    const delivered = Number(deliveredQty)
    if (!ordered || deliveredQty === '' || Number.isNaN(delivered)) return null
    const pct = (delivered / ordered) * 100
    if (pct >= 80) {
      return { ok: false, text: `${pct.toFixed(0)}% delivered — normally NOT eligible for a refund (your 80% rule).` }
    }
    return { ok: true, text: `${pct.toFixed(0)}% delivered — eligible for a refund (below 80%).` }
  }

  async function submitAction() {
    if (!actionModal) return
    setError('')

    if (actionModal.action === 'approve') {
      if (resolutionMethod === 'bank' && !receiptFile) {
        setError('Please attach a photo/screenshot as proof of the bank/UPI payment.')
        return
      }
      if (!refundAmount || Number(refundAmount) <= 0) {
        setError('Enter a valid refund amount.')
        return
      }
    }

    setBusy(true)
    let receiptPath = null

    if (actionModal.action === 'approve' && resolutionMethod === 'bank' && receiptFile) {
      const path = `${actionModal.request.user_id}/${Date.now()}-${receiptFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { error: uploadError } = await supabase.storage.from('refund-receipts').upload(path, receiptFile)
      if (uploadError) {
        setBusy(false)
        setError(uploadError.message)
        return
      }
      receiptPath = path
    }

    const { error: err } = await supabase.rpc('admin_review_refund_request', {
      p_refund_request_id: actionModal.request.id,
      p_action: actionModal.action,
      p_remark: remark || null,
      p_resolution_method: actionModal.action === 'approve' ? resolutionMethod : null,
      p_receipt_path: receiptPath,
      p_delivered_quantity: deliveredQty === '' ? null : Number(deliveredQty),
      p_amount: actionModal.action === 'approve' ? Number(refundAmount) : null
    })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setActionModal(null)
    load()
  }

  async function viewReceipt(path) {
    const { data } = await supabase.storage.from('refund-receipts').createSignedUrl(path, 300)
    if (data?.signedUrl) setReceiptModal(data.signedUrl)
  }

  async function viewCustomerProof(path) {
    const { data } = await supabase.storage.from('refund-customer-proof').createSignedUrl(path, 300)
    if (data?.signedUrl) setReceiptModal(data.signedUrl)
  }

  const visible = statusFilter === 'all' ? requests : requests.filter((r) => r.status === statusFilter)

  if (loading) return <Loader />

  const hint = actionModal ? eligibilityHint(actionModal.request) : null

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 19, margin: 0 }}>Refunds</h1>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 'auto' }}>
          <option value="all">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="surface-card">
        {visible.length === 0 && <p className="text-faint" style={{ fontSize: 13 }}>No refund requests found.</p>}
        {visible.map((r) => (
          <div key={r.id} style={{ borderBottom: '1px solid var(--border-soft)', padding: '12px 4px' }}>
            <div className="row-between">
              <div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{r.request_code}</div>
                <div className="text-faint" style={{ fontSize: 11 }}>
                  {r.profiles?.username || r.profiles?.email} · Order {r.orders?.order_code} · {formatDate(r.created_at)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontWeight: 700 }}>
                  {formatCurrency(r.status === 'approved' ? (r.approved_amount ?? r.amount) : r.amount)}
                </span>
                {r.status === 'approved' && r.approved_amount != null && r.approved_amount !== r.amount && (
                  <div className="text-faint" style={{ fontSize: 10.5 }}>Requested {formatCurrency(r.amount)}</div>
                )}
              </div>
            </div>
            {r.reason && <p className="text-faint" style={{ fontSize: 11.5, marginTop: 6 }}>Reason: {r.reason}</p>}
            <div className="row-between" style={{ marginTop: 8 }}>
              <span className={`chip ${r.status === 'pending' ? 'chip-warning' : r.status === 'approved' ? 'chip-success' : 'chip-danger'}`}>
                {r.status}{r.status === 'approved' && r.resolution_method ? ` · ${r.resolution_method}` : ''}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                {r.customer_proof_path && (
                  <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={() => viewCustomerProof(r.customer_proof_path)}>
                    Customer's Photo
                  </button>
                )}
                {r.status === 'approved' && r.resolution_method === 'bank' && r.receipt_path && (
                  <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={() => viewReceipt(r.receipt_path)}>
                    View Proof
                  </button>
                )}
                {r.status === 'pending' && (
                  <>
                    <button className="icon-btn" onClick={() => openAction(r, 'approve')}>
                      <Check size={14} color="var(--success)" />
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
          title={actionModal.action === 'approve' ? 'Approve Refund' : 'Reject Refund'}
          onClose={() => setActionModal(null)}
        >
          <p className="text-dim" style={{ fontSize: 12.5, marginBottom: 4 }}>
            {actionModal.request.request_code} · Order {actionModal.request.orders?.order_code} · {formatCurrency(actionModal.request.amount)}
          </p>
          {actionModal.request.reason && (
            <p className="text-faint" style={{ fontSize: 11.5, marginBottom: 10, background: 'var(--surface)', padding: 8, borderRadius: 8 }}>
              Customer's note: {actionModal.request.reason}
            </p>
          )}
          {actionModal.request.customer_proof_path && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ width: 'auto', marginBottom: 10 }}
              onClick={() => viewCustomerProof(actionModal.request.customer_proof_path)}
            >
              View Customer's Photo
            </button>
          )}
          <p className="text-faint" style={{ fontSize: 11.5, marginBottom: 12 }}>
            {(actionModal.request.orders?.order_items || []).map((i) => i.service_name_snapshot).join(', ') || 'Order details unavailable'}
            {' · Ordered qty: '}{orderedQty(actionModal.request)}
          </p>

          <span className="field-label">How much was actually delivered? (optional, helps you decide)</span>
          <input type="number" min="0" value={deliveredQty} onChange={(e) => setDeliveredQty(e.target.value)} placeholder="e.g. 80" />
          {hint && (
            <p className={hint.ok ? 'text-success' : 'text-warning'} style={{ fontSize: 11.5, marginTop: 6, marginBottom: 10 }}>
              {hint.text}
            </p>
          )}

          {actionModal.action === 'approve' && (
            <div style={{ marginTop: 10, marginBottom: 10 }}>
              <span className="field-label">Amount to Refund (₹)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                placeholder="e.g. 200"
              />
              <p className="text-faint" style={{ fontSize: 11, marginTop: 4, marginBottom: 10 }}>
                Defaults to what the customer requested ({formatCurrency(actionModal.request.amount)}) — edit this if GPay/PhonePe only went through partially, or you're refunding a different amount.
              </p>

              <span className="field-label">Refund Method</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className={`btn ${resolutionMethod === 'wallet' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                  style={{ width: 'auto', flex: 1 }}
                  onClick={() => setResolutionMethod('wallet')}
                >
                  <Wallet size={14} /> Wallet
                </button>
                <button
                  type="button"
                  className={`btn ${resolutionMethod === 'bank' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                  style={{ width: 'auto', flex: 1 }}
                  onClick={() => setResolutionMethod('bank')}
                >
                  <Landmark size={14} /> Bank / UPI
                </button>
              </div>
              {resolutionMethod === 'wallet' && (
                <p className="text-faint" style={{ fontSize: 11, marginTop: 6 }}>
                  {formatCurrency(Number(refundAmount) || 0)} will be added straight to the customer's wallet.
                </p>
              )}
              {resolutionMethod === 'bank' && (
                <div style={{ marginTop: 8 }}>
                  <p className="text-faint" style={{ fontSize: 11, marginBottom: 6 }}>
                    Pay {formatCurrency(Number(refundAmount) || 0)} to the customer yourself via bank/UPI, then attach a photo/screenshot as proof below.
                    This won't change their wallet balance (the money never sat there) — it'll just be logged in Wallet Transactions for your records.
                  </p>
                  <input type="file" accept="image/*" onChange={(e) => setReceiptFile(e.target.files?.[0] || null)} />
                </div>
              )}
            </div>
          )}

          <span className="field-label">Remark</span>
          <textarea rows={3} value={remark} onChange={(e) => setRemark(e.target.value)} />
          {error && <div className="field-error" style={{ marginTop: 8 }}>{error}</div>}
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={submitAction} disabled={busy}>
            {busy ? 'Submitting…' : 'Confirm'}
          </button>
        </Modal>
      )}

      {receiptModal && (
        <Modal title="Payment Proof" onClose={() => setReceiptModal(null)}>
          <img src={receiptModal} alt="refund payment proof" style={{ width: '100%', borderRadius: 12, border: '1px solid var(--border)' }} />
        </Modal>
      )}
    </div>
  )
}
