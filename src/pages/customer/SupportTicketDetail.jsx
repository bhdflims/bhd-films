import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Send, Upload, X, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import Loader from '../../components/common/Loader'
import EmptyState from '../../components/common/EmptyState'
import AttachmentPreview from '../../components/common/AttachmentPreview'
import { formatCurrency, formatDate } from '../../utils/format'
import { uploadSupportAttachment } from '../../utils/supportAttachments'
import { categoryLabel, statusMeta } from '../../utils/supportCategories'

export default function SupportTicketDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const instanceId = useId()
  const scrollRef = useRef(null)

  const [loading, setLoading] = useState(true)
  const [ticket, setTicket] = useState(null)
  const [messages, setMessages] = useState([])
  const [notFound, setNotFound] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const [reply, setReply] = useState('')
  const [file, setFile] = useState(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    const { data: t } = await supabase
      .from('support_tickets')
      .select('*, orders(*, order_items(*)), wallet_transactions(*), fund_requests(*)')
      .eq('id', id)
      .maybeSingle()
    if (!t) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setTicket(t)

    const { data: msgs } = await supabase.from('support_messages').select('*').eq('ticket_id', id).order('created_at', { ascending: true })
    setMessages(msgs || [])
    setLoading(false)

    // Only ping the server when there's actually something unread to
    // clear. Calling this unconditionally on every load used to create a
    // feedback loop: mark-as-read updates the ticket row -> realtime
    // fires because the row changed -> that re-triggers load() -> which
    // marks it as read again -> forever, hammering the database the
    // whole time this screen stays open.
    if (t.has_unread_admin_reply) {
      await supabase.rpc('mark_ticket_read', { p_ticket_id: id })
    }
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel(`support-ticket-${id}-${instanceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_messages', filter: `ticket_id=eq.${id}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets', filter: `id=eq.${id}` }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, instanceId])

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length])

  async function handleSend(e) {
    e.preventDefault()
    if (!reply.trim()) return
    setSending(true)
    setError('')
    try {
      let attachmentPath = null
      if (file) attachmentPath = await uploadSupportAttachment(user.id, file)

      const { error: rpcError } = await supabase.rpc('send_support_reply', {
        p_ticket_id: id,
        p_message: reply.trim(),
        p_attachment_url: attachmentPath
      })
      if (rpcError) throw rpcError
      setReply('')
      setFile(null)
      await load()
    } catch (e) {
      setError(e.message || 'Could not send message.')
    } finally {
      setSending(false)
    }
  }

  if (loading) return <Loader />
  if (notFound || !ticket) {
    return (
      <div className="page-pad">
        <EmptyState title="Ticket not found" subtitle="This ticket doesn't exist or isn't yours." />
      </div>
    )
  }

  const s = statusMeta(ticket.status)
  const isClosed = ticket.status === 'closed'

  return (
    <div className="page-pad" style={{ display: 'flex', flexDirection: 'column', minHeight: '85dvh' }}>
      <button
        onClick={() => navigate('/support')}
        style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 12.5, padding: 0, marginBottom: 10, cursor: 'pointer' }}
      >
        <ChevronLeft size={15} /> My Support Tickets
      </button>

      <div className="surface-card" style={{ marginBottom: 12 }}>
        <div className="row-between">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>{ticket.ticket_code}</div>
            <div className="text-dim" style={{ fontSize: 12.5, marginTop: 3 }}>{ticket.subject}</div>
            <div className="text-faint" style={{ fontSize: 11, marginTop: 3 }}>{categoryLabel(ticket.category)} · {formatDate(ticket.created_at)}</div>
          </div>
          <span className={`chip ${s.chip}`} style={{ flexShrink: 0 }}>{s.label}</span>
        </div>

        {(ticket.orders || ticket.wallet_transactions || ticket.fund_requests || ticket.transaction_ref || ticket.amount) && (
          <>
            <button
              onClick={() => setDetailsOpen((o) => !o)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--gold)', fontSize: 11.5, fontWeight: 600, padding: '10px 0 0', cursor: 'pointer' }}
            >
              {detailsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Related details
            </button>
            {detailsOpen && (
              <div style={{ marginTop: 8, paddingTop: 10, borderTop: '1px solid var(--border-soft)' }}>
                {ticket.orders && (
                  <div style={{ marginBottom: 8 }}>
                    <div className="row-between" style={{ fontSize: 12 }}>
                      <span className="text-faint">Order</span>
                      <span style={{ fontWeight: 700 }}>{ticket.orders.order_code} · {formatCurrency(ticket.orders.grand_total)}</span>
                    </div>
                    {(ticket.orders.order_items || []).map((it) => (
                      <div key={it.id} className="text-faint" style={{ fontSize: 11, marginTop: 3 }}>
                        {it.service_name_snapshot} · Qty {it.quantity}
                      </div>
                    ))}
                  </div>
                )}
                {ticket.wallet_transactions && (
                  <div className="row-between" style={{ fontSize: 12, marginBottom: 8 }}>
                    <span className="text-faint">Wallet Transaction</span>
                    <span style={{ fontWeight: 700 }}>{ticket.wallet_transactions.type.replace('_', ' ')} · {formatCurrency(ticket.wallet_transactions.amount)}</span>
                  </div>
                )}
                {ticket.transaction_ref && (
                  <div className="row-between" style={{ fontSize: 12, marginBottom: 8 }}>
                    <span className="text-faint">Transaction Ref</span>
                    <span>{ticket.transaction_ref}</span>
                  </div>
                )}
                {ticket.amount != null && (
                  <div className="row-between" style={{ fontSize: 12 }}>
                    <span className="text-faint">Amount</span>
                    <span style={{ fontWeight: 700 }}>{formatCurrency(ticket.amount)}</span>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        {messages.map((m) => (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: m.sender_type === 'customer' ? 'flex-end' : 'flex-start' }}>
            <div
              style={{
                maxWidth: '82%',
                borderRadius: 14,
                padding: '10px 13px',
                fontSize: 13,
                lineHeight: 1.5,
                background: m.sender_type === 'customer' ? 'linear-gradient(135deg, rgba(212,175,55,0.18), rgba(212,175,55,0.08))' : 'var(--surface)',
                border: `1px solid ${m.sender_type === 'customer' ? 'rgba(212,175,55,0.28)' : 'var(--border)'}`
              }}
            >
              <div style={{ fontSize: 10.5, fontWeight: 700, marginBottom: 4, color: m.sender_type === 'customer' ? 'var(--gold)' : 'var(--violet-soft, #8b5cf6)' }}>
                {m.sender_type === 'customer' ? 'You' : 'Support Team'}
              </div>
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.message}</div>
              <AttachmentPreview path={m.attachment_url} />
            </div>
            <span className="text-faint" style={{ fontSize: 10, marginTop: 3 }}>{formatDate(m.created_at)}</span>
          </div>
        ))}
        <div ref={scrollRef} />
      </div>

      {isClosed ? (
        <p className="text-faint" style={{ fontSize: 12, textAlign: 'center' }}>This ticket is closed.</p>
      ) : (
        <form onSubmit={handleSend} style={{ position: 'sticky', bottom: 8 }}>
          {file && (
            <div className="row-between" style={{ fontSize: 11.5, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '6px 10px', marginBottom: 6 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
              <button type="button" className="icon-btn" onClick={() => setFile(null)}>
                <X size={13} />
              </button>
            </div>
          )}
          {error && <div className="field-error" style={{ marginBottom: 6 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <label className="icon-btn" style={{ cursor: 'pointer', flexShrink: 0 }}>
              <Upload size={16} />
              <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
            <textarea
              rows={1}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Type a message…"
              style={{ flex: 1, resize: 'none' }}
            />
            <button className="btn btn-primary" style={{ width: 'auto', flexShrink: 0, padding: '10px 14px' }} disabled={sending || !reply.trim()}>
              <Send size={16} />
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
