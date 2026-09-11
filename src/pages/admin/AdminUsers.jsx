import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Loader from '../../components/common/Loader'
import Modal from '../../components/common/Modal'

const STAFF_PERMS = [
  'manage_categories',
  'manage_services',
  'manage_orders',
  'manage_fund_requests',
  'manage_offers',
  'manage_coupons',
  'manage_support',
  'view_customers',
  'view_audit_log'
]

export default function AdminUsers() {
  const [loading, setLoading] = useState(true)
  const [admins, setAdmins] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('staff')
  const [perms, setPerms] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('admin_users').select('*, profiles:id(username, email, full_name)').order('created_at', { ascending: false })
    setAdmins(data || [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleAdd() {
    setError('')
    if (!email.trim()) {
      setError('Enter the user\'s email address.')
      return
    }
    setBusy(true)
    const { data: profile, error: findErr } = await supabase.from('profiles').select('id').eq('email', email.trim()).maybeSingle()
    if (findErr || !profile) {
      setBusy(false)
      setError('No user found with that email. They must sign in to BHD Films at least once first.')
      return
    }
    const { error: err } = await supabase.from('admin_users').insert({
      id: profile.id,
      role,
      permissions: role === 'staff' ? perms : {}
    })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setModalOpen(false)
    setEmail('')
    setRole('staff')
    setPerms({})
    load()
  }

  async function handleRemove(admin) {
    if (!window.confirm('Remove admin access for this user?')) return
    await supabase.from('admin_users').delete().eq('id', admin.id)
    load()
  }

  if (loading) return <Loader />

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 19, margin: 0 }}>Admin Users</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setModalOpen(true)}>
          <Plus size={15} /> Add Admin
        </button>
      </div>

      <div className="surface-card">
        {admins.length === 0 && <p className="text-faint" style={{ fontSize: 13 }}>No admin users yet.</p>}
        {admins.map((a) => (
          <div key={a.id} className="list-row">
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{a.profiles?.full_name || a.profiles?.username}</div>
              <div className="text-faint" style={{ fontSize: 11 }}>{a.profiles?.email}</div>
            </div>
            <span className="chip chip-gold">{a.role}</span>
            <button className="icon-btn" onClick={() => handleRemove(a)}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {modalOpen && (
        <Modal title="Add Admin User" onClose={() => setModalOpen(false)}>
          <p className="text-faint" style={{ fontSize: 11.5, marginBottom: 10 }}>
            The user must have signed in to BHD Films at least once before they can be made an admin.
          </p>
          <div style={{ marginBottom: 10 }}>
            <span className="field-label">User Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <span className="field-label">Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
              <option value="super_admin">Super Admin</option>
            </select>
          </div>
          {role === 'staff' && (
            <div style={{ marginBottom: 10 }}>
              <span className="field-label">Staff Permissions</span>
              {STAFF_PERMS.map((p) => (
                <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12.5 }}>
                  <input
                    type="checkbox"
                    style={{ width: 16, height: 16 }}
                    checked={!!perms[p]}
                    onChange={(e) => setPerms({ ...perms, [p]: e.target.checked })}
                  />
                  {p}
                </label>
              ))}
              <p className="text-faint" style={{ fontSize: 10.5 }}>
                Staff can never manage wallets, rates, bulk pricing, payment settings (including Maintenance Mode), refunds, storage cleanup, or other admins, regardless of these checkboxes.
              </p>
            </div>
          )}
          {error && <div className="field-error" style={{ marginBottom: 10 }}>{error}</div>}
          <button className="btn btn-primary" onClick={handleAdd} disabled={busy}>
            {busy ? 'Adding…' : 'Add Admin'}
          </button>
        </Modal>
      )}
    </div>
  )
}
