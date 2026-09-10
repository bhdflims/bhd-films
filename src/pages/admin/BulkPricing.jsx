import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Loader from '../../components/common/Loader'
import Modal from '../../components/common/Modal'
import { formatRate } from '../../utils/format'

const EMPTY = { service_id: '', min_quantity: 100, max_quantity: '', rate: 0, is_active: true, display_order: 0, reason: '' }

export default function BulkPricing() {
  const [loading, setLoading] = useState(true)
  const [services, setServices] = useState([])
  const [tiers, setTiers] = useState([])
  const [filterService, setFilterService] = useState('all')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    const [svcRes, tierRes] = await Promise.all([
      supabase.from('services').select('*').order('display_order'),
      supabase.from('service_price_tiers').select('*').order('min_quantity')
    ])
    setServices(svcRes.data || [])
    setTiers(tierRes.data || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function openNew() {
    setForm({ ...EMPTY, service_id: services[0]?.id || '' })
    setError('')
    setEditing({})
  }

  function openEdit(tier) {
    setForm({ ...tier, max_quantity: tier.max_quantity ?? '', reason: '' })
    setError('')
    setEditing(tier)
  }

  async function handleSave() {
    setError('')
    setSaving(true)
    const { error: err } = await supabase.rpc('admin_upsert_price_tier', {
      p_tier_id: editing?.id || null,
      p_service_id: form.service_id,
      p_min_quantity: Number(form.min_quantity),
      p_max_quantity: form.max_quantity === '' ? null : Number(form.max_quantity),
      p_rate: Number(form.rate),
      p_is_active: !!form.is_active,
      p_display_order: Number(form.display_order) || 0,
      p_reason: form.reason || null
    })
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setEditing(null)
    load()
  }

  async function handleDelete(tier) {
    if (!window.confirm('Delete this pricing tier?')) return
    const { error: err } = await supabase.from('service_price_tiers').delete().eq('id', tier.id)
    if (err) {
      window.alert(err.message)
      return
    }
    load()
  }

  const serviceName = (id) => services.find((s) => s.id === id)?.name || '—'
  const visibleTiers = filterService === 'all' ? tiers : tiers.filter((t) => t.service_id === filterService)

  if (loading) return <Loader />

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 19, margin: 0 }}>Bulk Pricing</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={filterService} onChange={(e) => setFilterService(e.target.value)} style={{ width: 'auto' }}>
            <option value="all">All Services</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" onClick={openNew} disabled={services.length === 0}>
            <Plus size={15} /> Add Tier
          </button>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="table-simple">
          <thead>
            <tr>
              <th>Service</th>
              <th>Min Qty</th>
              <th>Max Qty</th>
              <th>Rate</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleTiers.map((t) => (
              <tr key={t.id}>
                <td>{serviceName(t.service_id)}</td>
                <td>{t.min_quantity}</td>
                <td>{t.max_quantity ?? '∞'}</td>
                <td>{formatRate(t.rate)}</td>
                <td>
                  <span className={`chip ${t.is_active ? 'chip-success' : 'chip-danger'}`}>{t.is_active ? 'Active' : 'Inactive'}</span>
                </td>
                <td>
                  <button className="icon-btn" onClick={() => openEdit(t)}>
                    <Pencil size={13} />
                  </button>
                  <button className="icon-btn" onClick={() => handleDelete(t)}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visibleTiers.length === 0 && <p className="text-faint" style={{ fontSize: 13, marginTop: 10 }}>No bulk pricing tiers yet.</p>}
      </div>

      {editing !== null && (
        <Modal title={editing?.id ? 'Edit Tier' : 'Add Tier'} onClose={() => setEditing(null)}>
          <div style={{ marginBottom: 10 }}>
            <span className="field-label">Service</span>
            <select value={form.service_id} onChange={(e) => setForm({ ...form, service_id: e.target.value })}>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="grid-2" style={{ marginBottom: 10 }}>
            <div>
              <span className="field-label">Min Quantity</span>
              <input type="number" value={form.min_quantity} onChange={(e) => setForm({ ...form, min_quantity: e.target.value })} />
            </div>
            <div>
              <span className="field-label">Max Quantity (blank = no limit)</span>
              <input type="number" value={form.max_quantity} onChange={(e) => setForm({ ...form, max_quantity: e.target.value })} />
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <span className="field-label">Rate (₹ per unit)</span>
            <input type="number" step="0.0001" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <span className="field-label">Reason (optional)</span>
            <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <input type="checkbox" style={{ width: 18, height: 18 }} checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Active
          </label>
          {error && <div className="field-error" style={{ marginBottom: 10 }}>{error}</div>}
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Tier'}
          </button>
        </Modal>
      )}
    </div>
  )
}
