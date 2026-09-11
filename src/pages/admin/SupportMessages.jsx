import { useEffect, useMemo, useState } from 'react'
import { Search, Send, Upload, X, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import Loader from '../../components/common/Loader'
import Modal from '../../components/common/Modal'
import AttachmentPreview from '../../components/common/AttachmentPreview'
import { formatCurrency, formatDate } from '../../utils/format'
import { uploadSupportAttachment } from '../../utils/supportAttachments'
import { CATEGORIES, STATUSES, categoryLabel, statusMeta } from '../../utils/supportCategories'

const TICKET_SELECT = '*, profiles:user_id(username, full_name, email, phone), orders(*, order_items(*)), wallet_transactions(*), fund_requests(*, fund_request_receipts(*))'

export default function SupportMessages() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [tickets, setTickets] = useState([])
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [active, setActive] = useState(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('support_tickets')
      .select(TICKET_SELECT)
      .order('last_message_at', { ascending: false })
      .limit(300)
    setTickets(data || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel('admin-support-tickets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_messages' }, () => {
        if (active) refreshActive(active.id)
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refreshActive(ticketId) {
    const { data } = await supabase.from('support_tickets').select(TICKET_SELECT).eq('id', ticketId).maybeSingle()
    if (data) setActive(data)
  }

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tickets.filter((t) => {
      if (categoryFilter !== 'all' && t.category !== categoryFilter) return false
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      if (unreadOnly && !t.has_unread_customer_message) return false
      if (!q) return true
      const haystack = [
        t.ticket_code,
        t.subject,
        t.user_id,
        t.orders?.order_code,
        t.profiles?.full_name,
        t.profiles?.username,
        t.profiles?.email,
        t.profiles?.phone
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [tickets, search, categoryFilter, statusFilter, unreadOnly])

  async function openTicket(t) {
    setActive(t)
    if (t.has_unread_customer_message) {
      await supabase.rpc('mark_ticket_read', { p_ticket_id: t.id })
      load()
    }
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 19, margin: 0 }}>Support Tickets</h1>
      </div>

      <div className="surface-card" style={{ marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 220px' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, mobile, order ID, ticket ID, user ID…"
            style={{ paddingLeft: 30 }}
          />
        </div>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ width: 'auto' }}>
          <option value="all">All Categories</option>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 'auto' }}>
          <option value="all">All Statuses</option>
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
          Unread only
        </label>
      </div>

      <div className="surface-card">
        {visible.length === 0 && <p className="text-faint" style={{ fontSize: 13 }}>No tickets found.</p>}
        {visible.map((t) => {
          const s = statusMeta(t.status)
          return (
            <div
              key={t.id}
              style={{ borderBottom: '1px solid var(--border-soft)', padding: '12px 4px', cursor: 'pointer', background: t.has_unread_customer_message ? 'rgba(212,175,55,0.06)' : undefined }}
              onClick={() => openTicket(t)}
            >
              <div className="row-between">
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontWeight: 700, fontSize: 13.5 }}>{t.ticket_code}</span>
                    {t.has_unread_customer_message && <span style={{ width: 7, height: 7, borderRadius: 4, background: 'var(--gold)' }} />}
                  </div>
                  <div className="text-dim" style={{ fontSize: 12, marginTop: 2 }}>{t.subject}</div>
                  <div className="text-faint" style={{ fontSize: 11, marginTop: 2 }}>
                    {t.profiles?.full_name || t.profiles?.username || 'Unknown'} · {t.profiles?.email} · {categoryLabel(t.category)} · {formatDate(t.last_message_at)}
                  </div>
                </div>
                <span className={`chip ${s.chip}`} style={{ flexShrink: 0 }}>{s.label}</span>
              </div>
            </div>
          )
        })}
      </div>

      {active && (
        <TicketModal
          ticket={active}
          adminUserId={user.id}
          onClose={() => setActive(null)}
          onChanged={() => {
            load()
            refreshActive(active.id)
          }}
        />
      )}
    </div>
  )
}

function TicketModal({ ticket, adminUserId, onClose, onChanged }) {
  const [messages, setMessages] = useState([])
  const [loadingMsgs, setLoadingMsgs] = useState(true)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [reply, setReply] = useState('')
  const [file, setFile] = useState(null)
  const [sending, setSending] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  const [error, setError] = useState('')

  async function loadMessages() {
    const { data } = await supabase.from('support_messages').select('*').eq('ticket_id', ticket.id).order('created_at', { ascending: true })
    setMessages(data || [])
    setLoadingMsgs(false)
  }

  useEffect(() => {
    loadMessages()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket.id])

  async function handleStatusChange(status) {
    setStatusBusy(true)
    const { error: err } = await supabase.rpc('admin_update_ticket_status', { p_ticket_id: ticket.id, p_status: status })
    setStatusBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    onChanged()
  }

  async function handleSend(e) {
    e.preventDefault()
    if (!reply.trim()) return
    setSending(true)
    setError('')
    try {
      let attachmentPath = null
      if (file) attachmentPath = await uploadSupportAttachment(adminUserId, file)

      const { error: rpcError } = await supabase.rpc('send_support_reply', {
        p_ticket_id: ticket.id,
        p_message: reply.trim(),
        p_attachment_url: attachmentPath
      })
      if (rpcError) throw rpcError

      const replyText = reply.trim()
      setReply('')
      setFile(null)
      await loadMessages()
      onChanged()

      // Email notification — best-effort; the in-app notification above
      // already happened inside the RPC regardless of email success.
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (token) {
        supabase.functions
          .invoke('send-support-email', {
            body: { ticketId: ticket.id, replyPreview: replyText.slice(0, 300) },
            headers: { Authorization: `Bearer ${token}` }
          })
          .catch(() => {})
      }
    } catch (e) {
      setError(e.message || 'Could not send reply.')
    } finally {
      setSending(false)
    }
  }

  const s = statusMeta(ticket.status)

  return (
    <Modal title={ticket.ticket_code} onClose={onClose}>
      <div style={{ maxHeight: '75vh', overflowY: 'auto', paddingRight: 2 }}>
        {/* Customer details — auto-fetched, never typed */}
        <div className="surface-card" style={{ marginBottom: 10 }}>
          <div className="row-between" style={{ marginBottom: 6 }}>
            <strong style={{ fontSize: 13 }}>{ticket.profiles?.full_name || ticket.profiles?.username || 'Unknown customer'}</strong>
            <span className={`chip ${s.chip}`}>{s.label}</span>
          </div>
          <div className="text-faint" style={{ fontSize: 11.5, lineHeight: 1.7 }}>
            Email: {ticket.profiles?.email || '—'}<br />
            Mobile: {ticket.profiles?.phone || 'Not provided'}<br />
            User ID: {ticket.user_id}
          </div>
        </div>

        {/* Ticket details */}
        <div className="surface-card" style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{ticket.subject}</div>
          <div className="text-faint" style={{ fontSize: 11 }}>
            {categoryLabel(ticket.category)}{ticket.sub_category ? ` · ${ticket.sub_category.replace('_', ' ')}` : ''} · Created {formatDate(ticket.created_at)}
          </div>

          {(ticket.orders || ticket.wallet_transactions || ticket.fund_requests || ticket.transaction_ref || ticket.amount || ticket.failure_message || ticket.occurred_location) && (
            <>
              <button
                onClick={() => setDetailsOpen((o) => !o)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: 'var(--gold)', fontSize: 11.5, fontWeight: 600, padding: '10px 0 0', cursor: 'pointer' }}
              >
                {detailsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Related Order / Payment / Wallet Details
              </button>
              {detailsOpen && (
                <div style={{ marginTop: 8, paddingTop: 10, borderTop: '1px solid var(--border-soft)' }}>
                  {ticket.orders && (
                    <div style={{ marginBottom: 8 }}>
                      <div className="row-between" style={{ fontSize: 12 }}>
                        <span className="text-faint">Order</span>
                        <span style={{ fontWeight: 700 }}>{ticket.orders.order_code}</span>
                      </div>
                      <div className="row-between" style={{ fontSize: 11.5, marginTop: 3 }}>
                        <span className="text-faint">Order Status / Total</span>
                        <span>{ticket.orders.status} · {formatCurrency(ticket.orders.grand_total)}</span>
                      </div>
                      {(ticket.orders.order_items || []).map((it) => (
                        <div key={it.id} className="text-faint" style={{ fontSize: 11, marginTop: 3 }}>
                          {it.service_name_snapshot} · Qty {it.quantity} · {formatCurrency(it.item_total)}
                          {it.target_link && <span style={{ wordBreak: 'break-all' }}> · {it.target_link}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {ticket.wallet_transactions && (
                    <div className="row-between" style={{ fontSize: 12, marginBottom: 8 }}>
                      <span className="text-faint">Wallet Transaction</span>
                      <span style={{ fontWeight: 700 }}>{ticket.wallet_transactions.type.replace('_', ' ')} · {formatCurrency(ticket.wallet_transactions.amount)} · {formatDate(ticket.wallet_transactions.created_at)}</span>
                    </div>
                  )}
                  {ticket.fund_requests && (
                    <div style={{ marginBottom: 8 }}>
                      <div className="row-between" style={{ fontSize: 12 }}>
                        <span className="text-faint">Fund Request</span>
                        <span style={{ fontWeight: 700 }}>{ticket.fund_requests.request_code} · {ticket.fund_requests.status}</span>
                      </div>
                      {(ticket.fund_requests.fund_request_receipts || []).map((r) => (
                        <div key={r.id} style={{ marginTop: 4 }}>
                          <AttachmentPreview path={r.storage_path} />
                        </div>
                      ))}
                    </div>
                  )}
                  {ticket.transaction_ref && (
                    <div className="row-between" style={{ fontSize: 12, marginBottom: 6 }}>
                      <span className="text-faint">Transaction Ref</span>
                      <span>{ticket.transaction_ref}</span>
                    </div>
                  )}
                  {ticket.payment_date && (
                    <div className="row-between" style={{ fontSize: 12, marginBottom: 6 }}>
                      <span className="text-faint">Payment Date</span>
                      <span>{ticket.payment_date}</span>
                    </div>
                  )}
                  {ticket.amount != null && (
                    <div className="row-between" style={{ fontSize: 12, marginBottom: 6 }}>
                      <span className="text-faint">Amount</span>
                      <span style={{ fontWeight: 700 }}>{formatCurrency(ticket.amount)}</span>
                    </div>
                  )}
                  {ticket.failure_message && (
                    <div className="row-between" style={{ fontSize: 12, marginBottom: 6 }}>
                      <span className="text-faint">Failure Message</span>
                      <span>{ticket.failure_message}</span>
                    </div>
                  )}
                  {ticket.occurred_location && (
                    <div className="row-between" style={{ fontSize: 12 }}>
                      <span className="text-faint">Occurred At</span>
                      <span>{ticket.occurred_location}</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Status changer */}
        <div style={{ marginBottom: 10 }}>
          <span className="field-label">Ticket Status</span>
          <select value={ticket.status} onChange={(e) => handleStatusChange(e.target.value)} disabled={statusBusy}>
            {STATUSES.map((s2) => (
              <option key={s2.value} value={s2.value}>{s2.label}</option>
            ))}
          </select>
        </div>

        {/* Conversation */}
        <div className="divider" />
        {loadingMsgs ? (
          <Loader />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '10px 0' }}>
            {messages.map((m) => (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: m.sender_type === 'admin' ? 'flex-end' : 'flex-start' }}>
                <div
                  style={{
                    maxWidth: '85%',
                    borderRadius: 12,
                    padding: '9px 12px',
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    background: m.sender_type === 'admin' ? 'linear-gradient(135deg, rgba(212,175,55,0.18), rgba(212,175,55,0.08))' : 'var(--surface)',
                    border: `1px solid ${m.sender_type === 'admin' ? 'rgba(212,175,55,0.28)' : 'var(--border)'}`
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 3, color: m.sender_type === 'admin' ? 'var(--gold)' : 'var(--violet-soft, #8b5cf6)' }}>
                    {m.sender_type === 'admin' ? 'Admin Support' : ticket.profiles?.full_name || 'Customer'}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.message}</div>
                  <AttachmentPreview path={m.attachment_url} />
                </div>
                <span className="text-faint" style={{ fontSize: 9.5, marginTop: 2 }}>{formatDate(m.created_at)}</span>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSend}>
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
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
            <textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply to customer…" style={{ flex: 1, resize: 'none' }} />
            <button className="btn btn-primary" style={{ width: 'auto', flexShrink: 0, padding: '10px 14px' }} disabled={sending || !reply.trim()}>
              <Send size={16} />
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}
