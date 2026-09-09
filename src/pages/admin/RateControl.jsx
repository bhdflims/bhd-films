import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Loader from '../../components/common/Loader'
import NotifyCustomersButton from '../../components/common/NotifyCustomersButton'
import { formatRate, formatDate } from '../../utils/format'

export default function RateControl() {
  const [loading, setLoading] = useState(true)
  const [categories, setCategories] = useState([])
  const [services, setServices] = useState([])
  const [edits, setEdits] = useState({}) // serviceId -> { rate, reason }
  const [saving, setSaving] = useState(null)
  const [message, setMessage] = useState('')
  const [expanded, setExpanded] = useState(null)
  const [history, setHistory] = useState({})
  const [justUpdated, setJustUpdated] = useState(null) // { id, name, rate }

  async function load() {
    setLoading(true)
    const [catRes, svcRes] = await Promise.all([
      supabase.from('categories').select('*').order('display_order'),
      supabase.from('services').select('*').order('display_order')
    ])
    setCategories(catRes.data || [])
    setServices(svcRes.data || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function updateEdit(id, patch) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  async function handleSave(svc) {
    const edit = edits[svc.id]
    if (!edit || edit.rate === undefined || edit.rate === '') return
    setSaving(svc.id)
    setMessage('')
    const { error } = await supabase.rpc('admin_update_service_rate', {
      p_service_id: svc.id,
      p_new_rate: Number(edit.rate),
      p_reason: edit.reason || null
    })
    setSaving(null)
    if (error) {
      setMessage(error.message)
      return
    }
    setJustUpdated({ id: svc.id, name: svc.name, rate: Number(edit.rate) })
    setEdits((prev) => ({ ...prev, [svc.id]: undefined }))
    load()
  }

  async function toggleHistory(svc) {
    if (expanded === svc.id) {
      setExpanded(null)
      return
    }
    setExpanded(svc.id)
    if (!history[svc.id]) {
      const { data } = await supabase
        .from('rate_history')
        .select('*')
        .eq('service_id', svc.id)
        .order('created_at', { ascending: false })
        .limit(20)
      setHistory((prev) => ({ ...prev, [svc.id]: data || [] }))
    }
  }

  const categoryName = (id) => categories.find((c) => c.id === id)?.name || '—'

  if (loading) return <Loader />

  return (
    <div>
      <h1 style={{ fontSize: 19, margin: '0 0 16px' }}>Rate Control</h1>
      <p className="text-dim" style={{ fontSize: 12.5, marginTop: -10, marginBottom: 16 }}>
        Update live base rates. Every change is recorded permanently in Rate History and never affects past orders.
      </p>
      {message && <div className="field-error" style={{ marginBottom: 12 }}>{message}</div>}

      <div className="surface-card">
        {services.map((svc) => {
          const edit = edits[svc.id] || {}
          return (
            <div key={svc.id} style={{ borderBottom: '1px solid var(--border-soft)', padding: '12px 4px' }}>
              <div className="row-between">
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{svc.name}</div>
                  <div className="text-faint" style={{ fontSize: 11 }}>{categoryName(svc.category_id)} · current: {formatRate(svc.base_rate)}</div>
                </div>
                <button className="icon-btn" onClick={() => toggleHistory(svc)}>
                  {expanded === svc.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
              </div>

              <div className="grid-2" style={{ marginTop: 10 }}>
                <input
                  type="number"
                  step="0.0001"
                  placeholder="New rate"
                  value={edit.rate ?? ''}
                  onChange={(e) => updateEdit(svc.id, { rate: e.target.value })}
                />
                <input
                  placeholder="Reason (optional)"
                  value={edit.reason ?? ''}
                  onChange={(e) => updateEdit(svc.id, { reason: e.target.value })}
                />
              </div>
              <button
                className="btn btn-primary btn-sm"
                style={{ marginTop: 8 }}
                disabled={saving === svc.id || edit.rate === undefined || edit.rate === ''}
                onClick={() => handleSave(svc)}
              >
                {saving === svc.id ? 'Saving…' : 'Update Rate'}
              </button>

              {justUpdated?.id === svc.id && (
                <div style={{ marginTop: 8 }}>
                  <NotifyCustomersButton
                    title="💸 Price Update"
                    body={`${justUpdated.name} is now ${formatRate(justUpdated.rate)} per unit on BHD Films.`}
                    url={`/services`}
                    label="Notify Customers of New Rate"
                  />
                </div>
              )}

              {expanded === svc.id && (
                <div style={{ marginTop: 10 }}>
                  {(history[svc.id] || []).length === 0 && <p className="text-faint" style={{ fontSize: 11.5 }}>No history yet.</p>}
                  {(history[svc.id] || []).map((h) => (
                    <div key={h.id} className="text-faint" style={{ fontSize: 11, marginBottom: 6 }}>
                      {formatDate(h.created_at)} · {h.field_changed}: {JSON.stringify(h.previous_value)} → {JSON.stringify(h.new_value)}
                      {h.reason ? ` · "${h.reason}"` : ''} {h.admin_email ? `· by ${h.admin_email}` : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
