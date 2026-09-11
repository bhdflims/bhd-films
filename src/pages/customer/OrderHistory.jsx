import { useEffect, useId, useState } from 'react'
import { ReceiptText, ChevronDown, ChevronUp, Undo2, Eye } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import Loader from '../../components/common/Loader'
import EmptyState from '../../components/common/EmptyState'
import Modal from '../../components/common/Modal'
import { formatCurrency, formatRate, formatDate } from '../../utils/format'
import { compressImage } from '../../utils/imageCompress'

const STATUS_CHIP = {
  received: 'chip-info',
  processing: 'chip-warning',
  completed: 'chip-success',
  cancelled: 'chip-danger',
  refunded: 'chip-gold'
}

const REFUND_ELIGIBLE_STATUSES = ['processing', 'completed']

export default function OrderHistory() {
  const { user } = useAuth()
  const instanceId = useId()
  const [loading, setLoading] = useState(true)
  const [orders, setOrders] = useState([])
  const [refundsByOrder, setRefundsByOrder] = useState({})
  const [expanded, setExpanded] = useState(null)
  const [refundModal, setRefundModal] = useState(null) // order being refunded
  const [refundReason, setRefundReason] = useState('')
  const [refundProofFile, setRefundProofFile] = useState(null)
  const [refundBusy, setRefundBusy] = useState(false)
  const [refundError, setRefundError] = useState('')
  const [receiptModal, setReceiptModal] = useState(null) // signed URL string

  async function load() {
    setLoading(true)
    const [ordersRes, refundsRes] = await Promise.all([
      supabase.from('orders').select('*, order_items(*)').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('refund_requests').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
    ])
    const grouped = {}
    for (const r of refundsRes.data || []) {
      if (!grouped[r.order_id]) grouped[r.order_id] = []
      grouped[r.order_id].push(r)
    }
    setOrders(ordersRes.data || [])
    setRefundsByOrder(grouped)
    setLoading(false)
  }

  useEffect(() => {
    let mounted = true
    async function run() {
      if (!mounted) return
      await load()
    }
    if (user) run()
    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Keep this screen live: if an admin updates an order's status or
  // approves/rejects a refund while this page is open, it should update
  // on its own instead of needing a manual refresh.
  useEffect(() => {
    if (!user) return undefined
    const channel = supabase
      .channel(`order-history-${user.id}-${instanceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `user_id=eq.${user.id}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'refund_requests', filter: `user_id=eq.${user.id}` }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, instanceId])

  function openRefundModal(order) {
    setRefundModal(order)
    setRefundReason('')
    setRefundProofFile(null)
    setRefundError('')
  }

  async function submitRefund() {
    if (!refundModal) return
    setRefundBusy(true)
    setRefundError('')

    let proofPath = null
    if (refundProofFile) {
      const uploadFile = await compressImage(refundProofFile)
      const path = `${user.id}/${Date.now()}-${uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { error: uploadError } = await supabase.storage.from('refund-customer-proof').upload(path, uploadFile)
      if (uploadError) {
        setRefundBusy(false)
        setRefundError(uploadError.message || 'Could not upload your photo.')
        return
      }
      proofPath = path
    }

    const { error } = await supabase.rpc('create_refund_request', {
      p_order_id: refundModal.id,
      p_reason: refundReason.trim() || null,
      p_customer_proof_path: proofPath
    })
    setRefundBusy(false)
    if (error) {
      setRefundError(error.message || 'Could not submit refund request.')
      return
    }
    setRefundModal(null)
    load()
  }

  async function viewRefundReceipt(refund) {
    const { data } = await supabase.storage.from('refund-receipts').createSignedUrl(refund.receipt_path, 300)
    if (data?.signedUrl) setReceiptModal(data.signedUrl)
  }

  if (loading) return <Loader />

  return (
    <div className="page-pad">
      <h1 style={{ fontSize: 18, margin: '4px 0 16px' }}>Order History</h1>

      {orders.length === 0 ? (
        <EmptyState icon={ReceiptText} title="No orders yet" subtitle="Your placed orders will show up here." />
      ) : (
        orders.map((order) => {
          const open = expanded === order.id
          const orderRefunds = refundsByOrder[order.id] || []
          const hasPendingRefund = orderRefunds.some((r) => r.status === 'pending')
          const latestRefund = orderRefunds[0]
          const canRequestRefund = REFUND_ELIGIBLE_STATUSES.includes(order.status) && !hasPendingRefund
          return (
            <div key={order.id} className="surface-card" style={{ marginBottom: 10 }}>
              <div className="row-between" style={{ cursor: 'pointer' }} onClick={() => setExpanded(open ? null : order.id)}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 13.5 }}>{order.order_code}</div>
                  <div className="text-faint" style={{ fontSize: 11 }}>
                    {order.category_name_snapshot} · {formatDate(order.created_at)}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`chip ${STATUS_CHIP[order.status] || 'chip-info'}`}>{order.status}</span>
                  {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
              </div>

              {open && (
                <>
                  <div className="divider" />
                  {(order.order_items || []).map((item) => (
                    <div key={item.id} style={{ marginBottom: 10 }}>
                      <div className="row-between" style={{ fontSize: 12.5 }}>
                        <span style={{ fontWeight: 700 }}>
                          {item.service_name_snapshot}
                          {item.service_external_id_snapshot != null && (
                            <span className="text-faint" style={{ fontWeight: 400 }}> (ID: {item.service_external_id_snapshot})</span>
                          )}
                        </span>
                        <span>{formatCurrency(item.item_total)}</span>
                      </div>
                      <div className="text-faint" style={{ fontSize: 11 }}>
                        Qty {item.quantity} × {formatRate(item.applied_rate)} / 1000
                      </div>
                      {item.target_link && (
                        <div className="text-faint" style={{ fontSize: 11, wordBreak: 'break-all' }}>
                          {item.target_link}
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="divider" />
                  {order.discount_amount > 0 && (
                    <div className="row-between" style={{ fontSize: 12.5, marginBottom: 6 }}>
                      <span className="text-faint">Coupon Discount {order.coupon_code ? `(${order.coupon_code})` : ''}</span>
                      <span className="text-success">- {formatCurrency(order.discount_amount)}</span>
                    </div>
                  )}
                  <div className="row-between" style={{ fontWeight: 800 }}>
                    <span>{order.discount_amount > 0 ? 'Amount Paid' : 'Grand Total'}</span>
                    <span className="text-gold">{formatCurrency(order.grand_total - (order.discount_amount || 0))}</span>
                  </div>
                  {order.estimated_time_text && (
                    <p className="text-faint" style={{ fontSize: 11, marginTop: 8 }}>
                      Estimated processing time: approximately {order.estimated_time_text}.
                    </p>
                  )}

                  <div style={{ marginTop: 12 }}>
                    {canRequestRefund && (
                      <button className="btn btn-secondary btn-sm" style={{ width: 'auto' }} onClick={() => openRefundModal(order)}>
                        <Undo2 size={14} /> Request Refund
                      </button>
                    )}
                    {hasPendingRefund && (
                      <span className="chip chip-warning">Refund Requested — Pending</span>
                    )}
                    {!hasPendingRefund && latestRefund?.status === 'approved' && (
                      <div>
                        <p className="text-faint" style={{ fontSize: 11, margin: 0 }}>
                          Refund approved · {latestRefund.resolution_method === 'wallet' ? 'added to your wallet' : 'paid via bank/UPI'}.
                        </p>
                        {latestRefund.resolution_method === 'bank' && latestRefund.receipt_path && (
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ width: 'auto', marginTop: 8 }}
                            onClick={() => viewRefundReceipt(latestRefund)}
                          >
                            <Eye size={14} /> View Payment Proof
                          </button>
                        )}
                      </div>
                    )}
                    {!hasPendingRefund && latestRefund?.status === 'rejected' && (
                      <p className="text-faint" style={{ fontSize: 11 }}>
                        Previous refund request was rejected{latestRefund.admin_remark ? `: ${latestRefund.admin_remark}` : '.'}
                        {canRequestRefund && ' You can request again below.'}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })
      )}

      {refundModal && (
        <Modal title="Request Refund" onClose={() => setRefundModal(null)}>
          <p className="text-dim" style={{ fontSize: 12.5, marginBottom: 4 }}>
            {refundModal.order_code}
          </p>
          <p style={{ fontSize: 13, marginBottom: 14 }}>
            Refund amount: <strong className="text-gold">{formatCurrency(refundModal.grand_total - (refundModal.discount_amount || 0))}</strong>
          </p>
          <p className="text-faint" style={{ fontSize: 11.5, marginBottom: 10 }}>
            This will be refunded to your BHD Films wallet once approved by our team. If you'd prefer it sent to your bank/UPI instead, mention that below along with your UPI ID, GPay number, or bank account details.
          </p>
          <span className="field-label">Reason (optional)</span>
          <textarea
            rows={4}
            value={refundReason}
            onChange={(e) => setRefundReason(e.target.value)}
            placeholder="e.g. Service not fully delivered. If you want bank/UPI refund instead of wallet, add your UPI ID or account number here."
          />
          <span className="field-label" style={{ marginTop: 10, display: 'block' }}>Attach a photo (optional)</span>
          <p className="text-faint" style={{ fontSize: 11, marginBottom: 6 }}>
            e.g. a screenshot of your UPI QR code, your payment receipt, or your bank details — only if you want a bank/UPI refund instead of wallet.
          </p>
          <input type="file" accept="image/*" onChange={(e) => setRefundProofFile(e.target.files?.[0] || null)} />
          {refundError && <div className="field-error" style={{ marginTop: 8 }}>{refundError}</div>}
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={submitRefund} disabled={refundBusy}>
            {refundBusy ? 'Submitting…' : 'Submit Refund Request'}
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
