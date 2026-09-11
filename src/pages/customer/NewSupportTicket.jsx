import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LifeBuoy, ChevronLeft, Upload, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import Loader from '../../components/common/Loader'
import { formatCurrency, formatDate } from '../../utils/format'
import { uploadSupportAttachment } from '../../utils/supportAttachments'
import {
  CATEGORIES,
  DROPPED_PROCESS_OPTIONS,
  WALLET_ISSUE_TYPES,
  ORDER_ISSUE_TYPES,
  RECEIPT_TYPES
} from '../../utils/supportCategories'

const MAX_ATTACHMENT_MB = 8

export default function NewSupportTicket() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()

  const [loadingData, setLoadingData] = useState(true)
  const [orders, setOrders] = useState([])
  const [walletTx, setWalletTx] = useState([])

  const [category, setCategory] = useState(null)

  // Shared fields
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [occurredLocation, setOccurredLocation] = useState('')
  const [orderId, setOrderId] = useState('')
  const [walletTransactionId, setWalletTransactionId] = useState('')
  const [transactionRef, setTransactionRef] = useState('')
  const [paymentDate, setPaymentDate] = useState('')
  const [amount, setAmount] = useState('')
  const [failureMessage, setFailureMessage] = useState('')
  const [walletIssueType, setWalletIssueType] = useState('')
  const [orderIssueType, setOrderIssueType] = useState('')
  const [droppedProcess, setDroppedProcess] = useState('')
  const [receiptType, setReceiptType] = useState('')
  const [file, setFile] = useState(null)

  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let mounted = true
    async function load() {
      const [{ data: ordersData }, { data: txData }] = await Promise.all([
        supabase.from('orders').select('*, order_items(*)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
        supabase.from('wallet_transactions').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50)
      ])
      if (!mounted) return
      setOrders(ordersData || [])
      setWalletTx(txData || [])
      setLoadingData(false)
    }
    if (user) load()
    return () => {
      mounted = false
    }
  }, [user])

  const selectedOrder = orders.find((o) => o.id === orderId) || null

  function resetCategoryFields() {
    setSubject('')
    setDescription('')
    setOccurredLocation('')
    setOrderId('')
    setWalletTransactionId('')
    setTransactionRef('')
    setPaymentDate('')
    setAmount('')
    setFailureMessage('')
    setWalletIssueType('')
    setOrderIssueType('')
    setDroppedProcess('')
    setReceiptType('')
    setFile(null)
    setError('')
  }

  function pickCategory(value) {
    resetCategoryFields()
    setCategory(value)
  }

  function validate() {
    if (!description.trim()) return 'Please describe the issue.'
    if (category === 'technical' && !subject.trim()) return 'Please enter a subject.'
    if (category === 'order' && !orderId) return 'Please select the order this is about.'
    if (category === 'order' && !orderIssueType) return 'Please select an issue type.'
    if (category === 'wallet' && !walletIssueType) return 'Please select a wallet issue type.'
    if (category === 'dropped' && !droppedProcess) return 'Please select what was dropped or failed.'
    if (category === 'receipt' && !orderId) return 'Please select the order this receipt/invoice is about.'
    if (category === 'receipt' && !receiptType) return 'Please select a receipt/invoice type.'
    if (category === 'other' && !subject.trim()) return 'Please enter a subject.'
    if (file && file.size > MAX_ATTACHMENT_MB * 1024 * 1024) return `Attachment must be smaller than ${MAX_ATTACHMENT_MB}MB.`
    return ''
  }

  function buildSubject() {
    if (category === 'technical' || category === 'other') return subject.trim()
    if (category === 'payment') return `Payment Issue${selectedOrder ? ` – Order ${selectedOrder.order_code}` : ''}`
    if (category === 'order') {
      const t = ORDER_ISSUE_TYPES.find((o) => o.value === orderIssueType)?.label || 'Order Issue'
      return `${t} – Order ${selectedOrder?.order_code || ''}`.trim()
    }
    if (category === 'wallet') return WALLET_ISSUE_TYPES.find((w) => w.value === walletIssueType)?.label || 'Wallet Issue'
    if (category === 'dropped') return `${DROPPED_PROCESS_OPTIONS.find((d) => d.value === droppedProcess)?.label || 'Process'} Dropped`
    if (category === 'failed_transaction') return `Failed Transaction${selectedOrder ? ` – Order ${selectedOrder.order_code}` : ''}`
    if (category === 'receipt') return `${RECEIPT_TYPES.find((r) => r.value === receiptType)?.label || 'Receipt/Invoice Issue'} – Order ${selectedOrder?.order_code || ''}`
    return 'Support Request'
  }

  function buildSubCategory() {
    if (category === 'dropped') return droppedProcess
    if (category === 'wallet') return walletIssueType
    if (category === 'order') return orderIssueType
    if (category === 'receipt') return receiptType
    return null
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const v = validate()
    if (v) {
      setError(v)
      return
    }
    setSubmitting(true)
    setError('')
    try {
      let attachmentPath = null
      if (file) {
        attachmentPath = await uploadSupportAttachment(user.id, file)
      }

      const { data, error: rpcError } = await supabase.rpc('create_support_ticket', {
        p_category: category,
        p_subject: buildSubject(),
        p_message: description.trim(),
        p_sub_category: buildSubCategory(),
        p_order_id: orderId || null,
        p_wallet_transaction_id: walletTransactionId || null,
        p_fund_request_id: null,
        p_transaction_ref: transactionRef.trim() || null,
        p_payment_date: paymentDate || null,
        p_amount: amount ? Number(amount) : null,
        p_failure_message: failureMessage.trim() || null,
        p_occurred_location: occurredLocation.trim() || null,
        p_attachment_url: attachmentPath
      })
      if (rpcError) throw rpcError

      navigate(`/support/${data.id}`, { replace: true })
    } catch (e) {
      setError(e.message || 'Could not submit ticket. Please try again.')
      setSubmitting(false)
    }
  }

  if (loadingData) return <Loader />

  return (
    <div className="page-pad">
      <button
        onClick={() => (category ? pickCategory(null) : navigate('/support'))}
        style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 12.5, padding: 0, marginBottom: 10, cursor: 'pointer' }}
      >
        <ChevronLeft size={15} /> {category ? 'Change category' : 'Back to Support'}
      </button>

      <h1 style={{ fontSize: 18, margin: '4px 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <LifeBuoy size={18} /> New Support Ticket
      </h1>

      {!category && (
        <>
          <p className="text-dim" style={{ fontSize: 12.5, marginTop: 0, marginBottom: 14 }}>
            What is this about?
          </p>
          <div className="surface-card" style={{ padding: 6 }}>
            {CATEGORIES.map((c) => (
              <button key={c.value} className="list-row" style={{ width: '100%', background: 'none', border: 'none' }} onClick={() => pickCategory(c.value)}>
                <c.icon size={17} />
                <span style={{ flex: 1, textAlign: 'left', fontSize: 13.5, fontWeight: 600 }}>{c.label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {category && (
        <form onSubmit={handleSubmit}>
          <div className="surface-card" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            {(() => {
              const c = CATEGORIES.find((x) => x.value === category)
              const Icon = c.icon
              return (
                <>
                  <Icon size={18} color="var(--gold)" />
                  <strong style={{ fontSize: 13.5 }}>{c.label}</strong>
                </>
              )
            })()}
          </div>

          <p className="text-faint" style={{ fontSize: 11, marginTop: -8, marginBottom: 14 }}>
            Submitting as {profile?.full_name || profile?.username} ({profile?.email})
          </p>

          {/* A. TECHNICAL */}
          {category === 'technical' && (
            <>
              <Field label="Subject" required>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder='e.g. "The website is not loading"' />
              </Field>
              <Field label="Describe the issue" required>
                <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
              <Field label="Where did the issue occur? (optional)">
                <input value={occurredLocation} onChange={(e) => setOccurredLocation(e.target.value)} placeholder="e.g. Login page, Services page…" />
              </Field>
              <AttachmentField file={file} setFile={setFile} />
            </>
          )}

          {/* B. PAYMENT */}
          {category === 'payment' && (
            <>
              <Field label="Select related order (optional)">
                <OrderSelect orders={orders} value={orderId} onChange={setOrderId} />
              </Field>
              {selectedOrder && <OrderSummary order={selectedOrder} />}
              <Field label="Payment / Transaction ID (if available)">
                <input value={transactionRef} onChange={(e) => setTransactionRef(e.target.value)} />
              </Field>
              <Field label="Payment date (optional)">
                <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
              </Field>
              <Field label="Amount paid (optional)">
                <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Field label="Describe the payment issue" required>
                <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
              <AttachmentField label="Upload payment screenshot / proof" file={file} setFile={setFile} />
            </>
          )}

          {/* C. ORDER */}
          {category === 'order' && (
            <>
              <Field label="Select order" required>
                <OrderSelect orders={orders} value={orderId} onChange={setOrderId} />
              </Field>
              {selectedOrder && <OrderSummary order={selectedOrder} />}
              <Field label="Issue type" required>
                <select value={orderIssueType} onChange={(e) => setOrderIssueType(e.target.value)}>
                  <option value="">Select…</option>
                  {ORDER_ISSUE_TYPES.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Description" required>
                <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
              <AttachmentField file={file} setFile={setFile} />
            </>
          )}

          {/* D. WALLET */}
          {category === 'wallet' && (
            <>
              <Field label="Wallet issue type" required>
                <select value={walletIssueType} onChange={(e) => setWalletIssueType(e.target.value)}>
                  <option value="">Select…</option>
                  {WALLET_ISSUE_TYPES.map((w) => (
                    <option key={w.value} value={w.value}>{w.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Describe the issue" required>
                <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
              <Field label="Related transaction (optional)">
                <WalletTxSelect rows={walletTx} value={walletTransactionId} onChange={setWalletTransactionId} />
              </Field>
              <AttachmentField file={file} setFile={setFile} />
            </>
          )}

          {/* E. DROPPED / FAILED PROCESS */}
          {category === 'dropped' && (
            <>
              <Field label="What was dropped / failed?" required>
                <select value={droppedProcess} onChange={(e) => setDroppedProcess(e.target.value)}>
                  <option value="">Select…</option>
                  {DROPPED_PROCESS_OPTIONS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </Field>

              {(droppedProcess === 'payment_process' || droppedProcess === 'order_process') && (
                <>
                  <Field label="Related order (if available)">
                    <OrderSelect orders={orders} value={orderId} onChange={setOrderId} />
                  </Field>
                  {selectedOrder && <OrderSummary order={selectedOrder} />}
                </>
              )}
              {droppedProcess === 'payment_process' && (
                <Field label="Transaction / payment reference (if available)">
                  <input value={transactionRef} onChange={(e) => setTransactionRef(e.target.value)} />
                </Field>
              )}
              {(droppedProcess === 'registration_process' || droppedProcess === 'other_process') && (
                <Field label="Page / step where it happened (optional)">
                  <input value={occurredLocation} onChange={(e) => setOccurredLocation(e.target.value)} />
                </Field>
              )}

              <Field label="Describe where the process stopped" required>
                <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
              <AttachmentField label="Upload screenshot (recommended)" file={file} setFile={setFile} />
            </>
          )}

          {/* F. FAILED TRANSACTION */}
          {category === 'failed_transaction' && (
            <>
              <Field label="Select related order (optional)">
                <OrderSelect orders={orders} value={orderId} onChange={setOrderId} />
              </Field>
              {selectedOrder && <OrderSummary order={selectedOrder} />}
              <Field label="Transaction / Payment ID">
                <input value={transactionRef} onChange={(e) => setTransactionRef(e.target.value)} />
              </Field>
              <Field label="Transaction date (optional)">
                <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
              </Field>
              <Field label="Amount (optional)">
                <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Field label="Failure message / error (if available)">
                <input value={failureMessage} onChange={(e) => setFailureMessage(e.target.value)} />
              </Field>
              <Field label="Description" required>
                <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
              <AttachmentField label="Upload payment screenshot / proof" file={file} setFile={setFile} />
            </>
          )}

          {/* G. RECEIPT / INVOICE */}
          {category === 'receipt' && (
            <>
              <Field label="Select order" required>
                <OrderSelect orders={orders} value={orderId} onChange={setOrderId} />
              </Field>
              {selectedOrder && <OrderSummary order={selectedOrder} />}
              <Field label="Receipt / invoice type" required>
                <select value={receiptType} onChange={(e) => setReceiptType(e.target.value)}>
                  <option value="">Select…</option>
                  {RECEIPT_TYPES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Describe the issue" required>
                <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
            </>
          )}

          {/* H. OTHER */}
          {category === 'other' && (
            <>
              <Field label="Subject" required>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} />
              </Field>
              <Field label="Description" required>
                <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
              <AttachmentField file={file} setFile={setFile} />
            </>
          )}

          {error && <div className="field-error" style={{ marginBottom: 12 }}>{error}</div>}

          <button className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit Ticket'}
          </button>
        </form>
      )}
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <span className="field-label">
        {label} {required && <span style={{ color: 'var(--danger)' }}>*</span>}
      </span>
      {children}
    </div>
  )
}

function OrderSelect({ orders, value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select an order…</option>
      {orders.map((o) => (
        <option key={o.id} value={o.id}>
          {o.order_code} · {formatDate(o.created_at)} · {formatCurrency(o.grand_total)}
        </option>
      ))}
    </select>
  )
}

function WalletTxSelect({ rows, value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select a transaction…</option>
      {rows.map((t) => (
        <option key={t.id} value={t.id}>
          {formatDate(t.created_at)} · {t.type.replace('_', ' ')} · {formatCurrency(t.amount)}
        </option>
      ))}
    </select>
  )
}

function OrderSummary({ order }) {
  return (
    <div className="surface-card" style={{ marginBottom: 14, background: 'rgba(212,175,55,0.05)' }}>
      <div className="row-between" style={{ marginBottom: 6 }}>
        <span className="text-faint" style={{ fontSize: 11 }}>Order</span>
        <span style={{ fontWeight: 700, fontSize: 12.5 }}>{order.order_code}</span>
      </div>
      <div className="row-between" style={{ marginBottom: 6 }}>
        <span className="text-faint" style={{ fontSize: 11 }}>Date</span>
        <span style={{ fontSize: 12 }}>{formatDate(order.created_at)}</span>
      </div>
      <div className="row-between" style={{ marginBottom: 6 }}>
        <span className="text-faint" style={{ fontSize: 11 }}>Status</span>
        <span className="chip chip-info" style={{ fontSize: 10.5 }}>{order.status}</span>
      </div>
      <div className="row-between">
        <span className="text-faint" style={{ fontSize: 11 }}>Amount</span>
        <span style={{ fontWeight: 700, fontSize: 12.5 }}>{formatCurrency(order.grand_total)}</span>
      </div>
      {(order.order_items || []).length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-soft)' }}>
          {order.order_items.map((it) => (
            <div key={it.id} className="text-faint" style={{ fontSize: 11, marginBottom: 3 }}>
              {it.service_name_snapshot} · Qty {it.quantity}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AttachmentField({ label = 'Upload screenshot / attachment (optional)', file, setFile }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <span className="field-label">{label}</span>
      {file ? (
        <div className="row-between" style={{ fontSize: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
          <button type="button" className="icon-btn" onClick={() => setFile(null)}>
            <X size={14} />
          </button>
        </div>
      ) : (
        <label className="btn btn-secondary" style={{ display: 'inline-flex', cursor: 'pointer' }}>
          <Upload size={15} /> Choose File
          <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
      )}
    </div>
  )
}
