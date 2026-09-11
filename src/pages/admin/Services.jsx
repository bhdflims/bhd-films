import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Loader from '../../components/common/Loader'
import Modal from '../../components/common/Modal'
import { formatRate } from '../../utils/format'

const PLATFORM_OPTIONS = ['instagram', 'facebook', 'tiktok', 'youtube', 'twitter', 'telegram', 'whatsapp', 'spotify', 'threads', 'linkedin', 'snapchat', 'pinterest', 'custom']

const EMPTY = {
  category_id: '',
  name: '',
  description: '',
  external_service_id: '',
  service_group: '',
  min_quantity: 100,
  max_quantity: 100000,
  base_rate: 0,
  is_fixed_price: false,
  requires_target_link: true,
  target_platform: 'custom',
  estimated_time_text: '3-5 minutes',
  is_active: true,
  is_popular: false,
  display_order: 0
}

export default function Services() {
  const [loading, setLoading] = useState(true)
  const [categories, setCategories] = useState([])
  const [services, setServices] = useState([])
  const [filterCategory, setFilterCategory] = useState('all')
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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

  function openNew() {
    setForm({ ...EMPTY, category_id: categories[0]?.id || '' })
    setError('')
    setEditing({})
  }

  function openEdit(svc) {
    setForm(svc)
    setError('')
    setEditing(svc)
  }

  async function handleSave() {
    setError('')
    if (!form.name.trim() || !form.category_id) {
      setError('Name and category are required.')
      return
    }
    if (!form.external_service_id || !Number.isInteger(Number(form.external_service_id))) {
      setError('Service ID (the supplier panel\'s service ID) is required and must be a whole number.')
      return
    }
    if (Number(form.max_quantity) < Number(form.min_quantity)) {
      setError('Maximum quantity must be greater than or equal to minimum quantity.')
      return
    }
    setSaving(true)
    const payload = {
      category_id: form.category_id,
      name: form.name.trim(),
      description: form.description || null,
      external_service_id: Number(form.external_service_id),
      service_group: form.service_group?.trim() || null,
      // Fixed-price services (e.g. a Watch Time package) are always
      // exactly quantity 1 - base_rate IS the price, not a per-1000 rate.
      min_quantity: form.is_fixed_price ? 1 : Number(form.min_quantity),
      max_quantity: form.is_fixed_price ? 1 : Number(form.max_quantity),
      base_rate: Number(form.base_rate),
      is_fixed_price: !!form.is_fixed_price,
      requires_target_link: !!form.requires_target_link,
      target_platform: form.target_platform,
      estimated_time_text: form.estimated_time_text || '3-5 minutes',
      is_active: !!form.is_active,
      is_popular: !!form.is_popular,
      display_order: Number(form.display_order) || 0
    }
    const query = editing?.id
      ? supabase.from('services').update(payload).eq('id', editing.id)
      : supabase.from('services').insert(payload)
    const { error: err } = await query
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setEditing(null)
    load()
  }

  async function toggleActive(svc) {
    await supabase.from('services').update({ is_active: !svc.is_active }).eq('id', svc.id)
    load()
  }

  async function handleDelete(svc) {
    if (!window.confirm(`Delete service "${svc.name}"? Past orders will keep their history.`)) return
    const { error: err } = await supabase.from('services').delete().eq('id', svc.id)
    if (err) {
      window.alert(err.message)
      return
    }
    load()
  }

  const categoryName = (id) => categories.find((c) => c.id === id)?.name || '—'
  const visibleServices = filterCategory === 'all' ? services : services.filter((s) => s.category_id === filterCategory)

  if (loading) return <Loader />

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 19, margin: 0 }}>Services</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} style={{ width: 'auto' }}>
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" onClick={openNew} disabled={categories.length === 0}>
            <Plus size={15} /> Add Service
          </button>
        </div>
      </div>

      {categories.length === 0 && <p className="text-faint" style={{ fontSize: 13 }}>Create a category first.</p>}

      <div className="surface-card">
        {visibleServices.length === 0 && <p className="text-faint" style={{ fontSize: 13 }}>No services yet.</p>}
        {visibleServices.map((svc) => (
          <div key={svc.id} className="list-row">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                {svc.name}
                {svc.external_service_id != null && (
                  <span className="chip chip-gold" style={{ marginLeft: 6, fontSize: 10 }}>ID: {svc.external_service_id}</span>
                )}
              </div>
              <div className="text-faint" style={{ fontSize: 11 }}>
                {categoryName(svc.category_id)}{svc.service_group ? ` · ${svc.service_group}` : ''} ·{' '}
                {svc.is_fixed_price ? `${formatRate(svc.base_rate)} flat package` : `${svc.min_quantity}–${svc.max_quantity} · ${formatRate(svc.base_rate)}/1000`}
              </div>
            </div>
            {svc.is_popular && <span className="chip chip-gold">Popular</span>}
            <span className={`chip ${svc.is_active ? 'chip-success' : 'chip-danger'}`} style={{ cursor: 'pointer' }} onClick={() => toggleActive(svc)}>
              {svc.is_active ? 'Active' : 'Inactive'}
            </span>
            <button className="icon-btn" onClick={() => openEdit(svc)}>
              <Pencil size={14} />
            </button>
            <button className="icon-btn" onClick={() => handleDelete(svc)}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {editing !== null && (
        <Modal title={editing?.id ? 'Edit Service' : 'Add Service'} onClose={() => setEditing(null)}>
          <div style={{ marginBottom: 10 }}>
            <span className="field-label">Category</span>
            <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: 10 }}>
            <span className="field-label">Service Name</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Followers" />
          </div>
          <div className="grid-2" style={{ marginBottom: 10 }}>
            <div>
              <span className="field-label">Service ID (supplier panel ID)</span>
              <input type="number" value={form.external_service_id} onChange={(e) => setForm({ ...form, external_service_id: e.target.value })} placeholder="e.g. 3585" />
            </div>
            <div>
              <span className="field-label">Group (optional, e.g. Likes)</span>
              <input value={form.service_group || ''} onChange={(e) => setForm({ ...form, service_group: e.target.value })} placeholder="e.g. Followers" />
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <span className="field-label">Description</span>
            <textarea rows={2} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <input
              type="checkbox"
              style={{ width: 18, height: 18 }}
              checked={form.is_fixed_price}
              onChange={(e) => setForm({ ...form, is_fixed_price: e.target.checked })}
            />
            Fixed-price package (e.g. YouTube Watch Time) — sold as one flat package, not scaled by quantity
          </label>
          {!form.is_fixed_price && (
            <div className="grid-2" style={{ marginBottom: 10 }}>
              <div>
                <span className="field-label">Minimum Quantity</span>
                <input type="number" value={form.min_quantity} onChange={(e) => setForm({ ...form, min_quantity: e.target.value })} />
              </div>
              <div>
                <span className="field-label">Maximum Quantity</span>
                <input type="number" value={form.max_quantity} onChange={(e) => setForm({ ...form, max_quantity: e.target.value })} />
              </div>
            </div>
          )}
          <div style={{ marginBottom: 10 }}>
            <span className="field-label">{form.is_fixed_price ? 'Package Price (₹, flat)' : 'Base Rate (₹ per 1000)'}</span>
            <input type="number" step="0.0001" value={form.base_rate} onChange={(e) => setForm({ ...form, base_rate: e.target.value })} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <input type="checkbox" style={{ width: 18, height: 18 }} checked={form.requires_target_link} onChange={(e) => setForm({ ...form, requires_target_link: e.target.checked })} />
            Requires target link
          </label>
          {form.requires_target_link && (
            <div style={{ marginBottom: 10 }}>
              <span className="field-label">Allowed Target Platform</span>
              <select value={form.target_platform} onChange={(e) => setForm({ ...form, target_platform: e.target.value })}>
                {PLATFORM_OPTIONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          )}
          <div style={{ marginBottom: 10 }}>
            <span className="field-label">Estimated Processing Time</span>
            <input value={form.estimated_time_text} onChange={(e) => setForm({ ...form, estimated_time_text: e.target.value })} placeholder="e.g. 3-5 minutes" />
          </div>
          <div style={{ marginBottom: 10 }}>
            <span className="field-label">Display Order</span>
            <input type="number" value={form.display_order} onChange={(e) => setForm({ ...form, display_order: e.target.value })} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <input type="checkbox" style={{ width: 18, height: 18 }} checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Active
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <input type="checkbox" style={{ width: 18, height: 18 }} checked={form.is_popular} onChange={(e) => setForm({ ...form, is_popular: e.target.checked })} />
            Show in Home "Popular Services"
          </label>
          {error && <div className="field-error" style={{ marginBottom: 10 }}>{error}</div>}
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Service'}
          </button>
        </Modal>
      )}
    </div>
  )
}
