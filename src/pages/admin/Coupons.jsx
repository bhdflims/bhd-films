import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Copy, Check } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Loader from '../../components/common/Loader'
import Modal from '../../components/common/Modal'
import { ICON_KEYS } from '../../utils/iconMap'
import { formatCurrency } from '../../utils/format'

const EMPTY = {
  code: '',
  title: '',
  description: '',
  icon: 'gift',
  discount_type: 'fixed',
  discount_value: '',
  max_discount_amount: '',
  min_order_amount: '',
  usage_limit_per_user: '1',
  total_usage_limit: '',
  valid_from: '',
  valid_until: '',
  is_active: true,
  display_order: 0
}

export default function Coupons() {
  const [loading, setLoading] = useState(true)
  const [coupons, setCoupons] = useState([])
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('coupons').select('*').order('display_order').order('created_at', { ascending: false })
    setCoupons(data || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function openNew() {
    setForm(EMPTY)
    setError('')
    setEditing({})
  }

  function openEdit(c) {
    setForm({
      ...c,
      discount_value: String(c.discount_value ?? ''),
      max_discount_amount: c.max_discount_amount != null ? String(c.max_discount_amount) : '',
      min_order_amount: String(c.min_order_amount ?? ''),
      usage_limit_per_user: c.usage_limit_per_user != null ? String(c.usage_limit_per_user) : '',
      total_usage_limit: c.total_usage_limit != null ? String(c.total_usage_limit) : '',
      valid_from: c.valid_from || '',
      valid_until: c.valid_until || ''
    })
    setError('')
    setEditing(c)
  }

  async function handleSave() {
    setError('')
    if (!form.code.trim()) {
      setError('Coupon code is required.')
      return
    }
    if (!form.title.trim()) {
      setError('Title is required.')
      return
    }
    const discountValue = Number(form.discount_value)
    if (!discountValue || discountValue <= 0) {
      setError('Enter a discount value greater than 0.')
      return
    }
    if (form.discount_type === 'percent' && discountValue > 100) {
      setError('Percent discount cannot be more than 100.')
      return
    }
    if (form.valid_from && form.valid_until && form.valid_until < form.valid_from) {
      setError('"Valid until" cannot be before "Valid from".')
      return
    }

    setSaving(true)
    const payload = {
      code: form.code.trim().toUpperCase(),
      title: form.title.trim(),
      description: form.description || null,
      icon: form.icon,
      discount_type: form.discount_type,
      discount_value: discountValue,
      max_discount_amount: form.max_discount_amount ? Number(form.max_discount_amount) : null,
      min_order_amount: form.min_order_amount ? Number(form.min_order_amount) : 0,
      usage_limit_per_user: form.usage_limit_per_user ? Number(form.usage_limit_per_user) : null,
      total_usage_limit: form.total_usage_limit ? Number(form.total_usage_limit) : null,
      valid_from: form.valid_from || null,
      valid_until: form.valid_until || null,
      is_active: !!form.is_active,
      display_order: Number(form.display_order) || 0
    }
    const query = editing?.id ? supabase.from('coupons').update(payload).eq('id', editing.id) : supabase.from('coupons').insert(payload)
    const { error: err } = await query
    setSaving(false)
    if (err) {
      setError(err.message.includes('duplicate') || err.message.includes('unique') ? 'A coupon with this code already exists.' : err.message)
      return
    }
    setEditing(null)
    load()
  }

  async function toggleActive(c) {
    await supabase.from('coupons').update({ is_active: !c.is_active }).eq('id', c.id)
    load()
  }

  async function handleDelete(c) {
    if (!window.confirm(`Delete coupon "${c.code}"?`)) return
    await supabase.from('coupons').delete().eq('id', c.id)
    load()
  }

  function copyCode(c) {
    navigator.clipboard?.writeText(c.code)
    setCopiedId(c.id)
    setTimeout(() => setCopiedId((id) => (id === c.id ? null : id)), 1500)
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 19, margin: 0 }}>Coupons</h1>
        <button className="btn btn-primary btn-sm" onClick={openNew}>
          <Plus size={15} /> Add Coupon
        </button>
      </div>

      <div className="surface-card">
        {coupons.length === 0 && <p className="text-faint" style={{ fontSize: 13 }}>No coupons yet.</p>}
        {coupons.map((c) => (
          <div key={c.id} style={{ borderBottom: '1px solid var(--border-soft)', padding: '12px 4px' }}>
            <div className="row-between">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 800, fontSize: 13.5, letterSpacing: 0.5 }}>{c.code}</span>
                  <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => copyCode(c)} aria-label="Copy code">
                    {copiedId === c.id ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </div>
                <div className="text-dim" style={{ fontSize: 12, marginTop: 2 }}>{c.title}</div>
                <div className="text-faint" style={{ fontSize: 11, marginTop: 2 }}>
                  {c.discount_type === 'percent' ? `${c.discount_value}% off` : `${formatCurrency(c.discount_value)} off`}
                  {c.min_order_amount > 0 ? ` · Min order ${formatCurrency(c.min_order_amount)}` : ''}
                  {' · Used '}{c.times_used}{c.total_usage_limit ? `/${c.total_usage_limit}` : ''}
                </div>
              </div>
              <span className={`chip ${c.is_active ? 'chip-success' : 'chip-danger'}`} style={{ cursor: 'pointer', flexShrink: 0 }} onClick={() => toggleActive(c)}>
                {c.is_active ? 'Active' : 'Inactive'}
              </span>
              <button className="icon-btn" onClick={() => openEdit(c)}>
                <Pencil size={14} />
              </button>
              <button className="icon-btn" onClick={() => handleDelete(c)}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {editing !== null && (
        <Modal title={editing?.id ? 'Edit Coupon' : 'Add Coupon'} onClose={() => setEditing(null)}>
          <div className="grid-2" style={{ marginBottom: 10 }}>
            <div>
              <span className="field-label">Coupon Code</span>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="FESTIVE10"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div>
              <span className="field-label">Icon</span>
              <select value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })}>
                {ICON_KEYS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <span className="field-label">Title (shown to customers)</span>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Festive Offer" />
          </div>
          <div style={{ marginBottom: 10 }}>
            <span className="field-label">Description</span>
            <textarea rows={2} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Flat ₹10 off on your order" />
          </div>

          <div className="grid-2" style={{ marginBottom: 10 }}>
            <div>
              <span className="field-label">Discount Type</span>
              <select value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value })}>
                <option value="fixed">Fixed amount (₹)</option>
                <option value="percent">Percentage (%)</option>
              </select>
            </div>
            <div>
              <span className="field-label">Discount Value</span>
              <input type="number" min="0" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })} placeholder={form.discount_type === 'percent' ? '10' : '10'} />
            </div>
          </div>

          {form.discount_type === 'percent' && (
            <div style={{ marginBottom: 10 }}>
              <span className="field-label">Max Discount Cap (₹, optional)</span>
              <input type="number" min="0" value={form.max_discount_amount} onChange={(e) => setForm({ ...form, max_discount_amount: e.target.value })} placeholder="Leave blank for no cap" />
            </div>
          )}

          <div style={{ marginBottom: 10 }}>
            <span className="field-label">Minimum Order Amount (₹)</span>
            <input type="number" min="0" value={form.min_order_amount} onChange={(e) => setForm({ ...form, min_order_amount: e.target.value })} placeholder="0" />
          </div>

          <div className="grid-2" style={{ marginBottom: 10 }}>
            <div>
              <span className="field-label">Uses Per Customer</span>
              <input type="number" min="1" value={form.usage_limit_per_user} onChange={(e) => setForm({ ...form, usage_limit_per_user: e.target.value })} placeholder="Leave blank for unlimited" />
            </div>
            <div>
              <span className="field-label">Total Uses (all customers)</span>
              <input type="number" min="1" value={form.total_usage_limit} onChange={(e) => setForm({ ...form, total_usage_limit: e.target.value })} placeholder="Leave blank for unlimited" />
            </div>
          </div>

          <div className="grid-2" style={{ marginBottom: 10 }}>
            <div>
              <span className="field-label">Valid From</span>
              <input type="date" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} />
            </div>
            <div>
              <span className="field-label">Valid Until</span>
              <input type="date" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} />
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <span className="field-label">Display Order</span>
            <input type="number" value={form.display_order} onChange={(e) => setForm({ ...form, display_order: e.target.value })} />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <input type="checkbox" style={{ width: 18, height: 18 }} checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Active (shown on Home page and redeemable at checkout)
          </label>

          {error && <div className="field-error" style={{ marginBottom: 10 }}>{error}</div>}
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Coupon'}
          </button>
        </Modal>
      )}
    </div>
  )
}
