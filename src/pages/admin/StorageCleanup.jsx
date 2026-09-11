import { useEffect, useState } from 'react'
import { HardDrive, Trash2, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Loader from '../../components/common/Loader'
import { formatBytes, formatDate } from '../../utils/format'

// Supabase's free-tier Storage limit. If the project is ever upgraded to
// a paid plan with more space, just change this one number.
const PLAN_LIMIT_BYTES = 500 * 1024 * 1024

const BROWSABLE_BUCKETS = [
  { id: 'support-attachments', label: 'Support Ticket Screenshots' },
  { id: 'refund-receipts', label: 'Refund Payout Receipts (admin-uploaded)' },
  { id: 'refund-customer-proof', label: 'Refund Proof Photos (customer-uploaded)' }
]

const BUCKET_LABELS = {
  receipts: 'Payment Receipts (Add Funds)',
  'payment-qr': 'Payment QR Code Images',
  'support-attachments': 'Support Ticket Screenshots',
  'refund-receipts': 'Refund Payout Receipts',
  'refund-customer-proof': 'Refund Proof Photos'
}

export default function StorageCleanup() {
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState([])
  const [qrOrphans, setQrOrphans] = useState([])
  const [qrBusy, setQrBusy] = useState(false)
  const [message, setMessage] = useState('')

  const [selectedBucket, setSelectedBucket] = useState(BROWSABLE_BUCKETS[0].id)
  const [beforeDate, setBeforeDate] = useState('')
  const [files, setFiles] = useState([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [checked, setChecked] = useState({})
  const [deleteBusy, setDeleteBusy] = useState(false)

  async function loadSummary() {
    setLoading(true)
    const [{ data: summaryData, error: summaryErr }, { data: qrData }] = await Promise.all([
      supabase.rpc('storage_usage_summary'),
      supabase.rpc('storage_qr_orphans')
    ])
    if (summaryErr) setMessage(summaryErr.message)
    setSummary(summaryData || [])
    setQrOrphans(qrData || [])
    setLoading(false)
  }

  useEffect(() => {
    loadSummary()
  }, [])

  const totalBytes = summary.reduce((sum, row) => sum + Number(row.total_bytes || 0), 0)
  const usedPct = Math.min(100, Math.round((totalBytes / PLAN_LIMIT_BYTES) * 100))
  const qrOrphanBytes = qrOrphans.reduce((sum, f) => sum + Number(f.size_bytes || 0), 0)

  async function handleDeleteQrOrphans() {
    if (qrOrphans.length === 0) return
    if (!window.confirm(`Delete ${qrOrphans.length} old QR image(s), freeing ${formatBytes(qrOrphanBytes)}? None of these are currently shown to customers — this is safe.`)) return
    setQrBusy(true)
    setMessage('')
    const { data, error } = await supabase.rpc('storage_delete_qr_orphans')
    setQrBusy(false)
    if (error) {
      setMessage(error.message)
      return
    }
    const row = Array.isArray(data) ? data[0] : data
    setMessage(`Deleted ${row?.deleted_count ?? 0} old QR image(s), freed ${formatBytes(row?.freed_bytes ?? 0)}.`)
    loadSummary()
  }

  async function loadFiles() {
    setFilesLoading(true)
    setChecked({})
    const before = beforeDate ? new Date(beforeDate + 'T23:59:59').toISOString() : null
    const { data, error } = await supabase.rpc('storage_list_files', { p_bucket: selectedBucket, p_before: before })
    setFilesLoading(false)
    if (error) {
      setMessage(error.message)
      setFiles([])
      return
    }
    setFiles(data || [])
  }

  useEffect(() => {
    loadFiles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBucket])

  const selectedNames = Object.keys(checked).filter((k) => checked[k])
  const selectedBytes = files.filter((f) => checked[f.name]).reduce((sum, f) => sum + Number(f.size_bytes || 0), 0)

  function toggleAll(value) {
    const next = {}
    if (value) files.forEach((f) => { next[f.name] = true })
    setChecked(next)
  }

  async function handleDeleteSelected() {
    if (selectedNames.length === 0) return
    if (
      !window.confirm(
        `Delete ${selectedNames.length} file(s), freeing ${formatBytes(selectedBytes)}?\n\nIf any of these belong to an old support ticket or refund, that record will still show up in history but its photo will no longer open. This cannot be undone.`
      )
    ) {
      return
    }
    setDeleteBusy(true)
    setMessage('')
    const { data, error } = await supabase.rpc('storage_delete_files', { p_bucket: selectedBucket, p_names: selectedNames })
    setDeleteBusy(false)
    if (error) {
      setMessage(error.message)
      return
    }
    const row = Array.isArray(data) ? data[0] : data
    setMessage(`Deleted ${row?.deleted_count ?? 0} file(s), freed ${formatBytes(row?.freed_bytes ?? 0)}.`)
    loadFiles()
    loadSummary()
  }

  if (loading) return <Loader />

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="row-between" style={{ marginBottom: 6 }}>
        <h1 style={{ fontSize: 19, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <HardDrive size={19} /> Storage Cleanup
        </h1>
        <button className="icon-btn" onClick={loadSummary} aria-label="Refresh">
          <RefreshCw size={16} />
        </button>
      </div>
      <p className="text-faint" style={{ fontSize: 12, marginTop: 0, marginBottom: 18 }}>
        Every screenshot customers or admins upload — payment receipts, support ticket photos, refund proof,
        QR codes — is stored here. Your Supabase plan gives you 500 MB total. This page shows where that
        space is going and lets you safely remove what's no longer needed.
      </p>

      <div className="surface-card" style={{ marginBottom: 16 }}>
        <div className="row-between" style={{ marginBottom: 8 }}>
          <strong style={{ fontSize: 13.5 }}>Total space used</strong>
          <span style={{ fontSize: 13.5, fontWeight: 800 }}>
            {formatBytes(totalBytes)} <span className="text-faint" style={{ fontWeight: 400 }}>/ 500 MB ({usedPct}%)</span>
          </span>
        </div>
        <div style={{ height: 8, borderRadius: 6, background: 'var(--surface-strong)', overflow: 'hidden', marginBottom: 14 }}>
          <div
            style={{
              height: '100%',
              width: `${usedPct}%`,
              background: usedPct > 85 ? 'var(--crimson)' : usedPct > 60 ? 'var(--warning)' : 'var(--gold)'
            }}
          />
        </div>

        {summary.map((row) => (
          <div key={row.bucket_id} className="list-row">
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{BUCKET_LABELS[row.bucket_id] || row.bucket_id}</div>
              <div className="text-faint" style={{ fontSize: 11 }}>{row.file_count} file(s)</div>
            </div>
            {row.bucket_id === 'receipts' && <span className="chip" style={{ fontSize: 10.5, marginRight: 8 }}>Protected</span>}
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>{formatBytes(row.total_bytes)}</span>
          </div>
        ))}
        <p className="text-faint" style={{ fontSize: 10.5, marginTop: 10, marginBottom: 0 }}>
          Payment Receipts are protected and can never be deleted from here or anywhere in the app — they're your
          permanent proof of what customers paid.
        </p>
      </div>

      <div className="surface-card" style={{ marginBottom: 16 }}>
        <strong style={{ fontSize: 13.5 }}>Old QR code images — safe to clean up</strong>
        <p className="text-faint" style={{ fontSize: 11.5, margin: '6px 0 10px' }}>
          Every time a QR code is replaced in Payment Settings, the old image stays behind unused. These
          {qrOrphans.length > 0 ? ` ${qrOrphans.length} image(s)` : ''} aren't shown to any customer anywhere, so
          deleting them is always safe.
        </p>
        {qrOrphans.length === 0 ? (
          <p className="text-faint" style={{ fontSize: 12 }}>Nothing to clean up right now.</p>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={handleDeleteQrOrphans} disabled={qrBusy}>
            <Trash2 size={14} /> {qrBusy ? 'Deleting…' : `Delete ${qrOrphans.length} old QR image(s) (${formatBytes(qrOrphanBytes)})`}
          </button>
        )}
      </div>

      <div className="surface-card">
        <strong style={{ fontSize: 13.5 }}>Review &amp; delete old screenshots by hand</strong>
        <p className="text-faint" style={{ fontSize: 11.5, margin: '6px 0 12px' }}>
          These photos are linked to support tickets and refund requests, even old resolved ones. Deleting a
          file here does <strong>not</strong> delete the ticket or refund itself — it just means that old record's
          photo can no longer be opened. Only delete ones you're sure you won't need to look back at.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <div style={{ flex: '1 1 220px' }}>
            <span className="field-label">Bucket</span>
            <select value={selectedBucket} onChange={(e) => setSelectedBucket(e.target.value)}>
              {BROWSABLE_BUCKETS.map((b) => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <span className="field-label">Uploaded before (optional)</span>
            <input type="date" value={beforeDate} onChange={(e) => setBeforeDate(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={loadFiles} disabled={filesLoading}>
              {filesLoading ? 'Loading…' : 'Apply Filter'}
            </button>
          </div>
        </div>

        {filesLoading ? (
          <Loader />
        ) : files.length === 0 ? (
          <p className="text-faint" style={{ fontSize: 12 }}>No files found in this bucket{beforeDate ? ' before that date' : ''}.</p>
        ) : (
          <>
            <div className="row-between" style={{ marginBottom: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <input
                  type="checkbox"
                  style={{ width: 15, height: 15 }}
                  checked={files.length > 0 && selectedNames.length === files.length}
                  onChange={(e) => toggleAll(e.target.checked)}
                />
                Select all {files.length} file(s)
              </label>
              <span className="text-faint" style={{ fontSize: 11 }}>
                {selectedNames.length} selected · {formatBytes(selectedBytes)}
              </span>
            </div>

            <div style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 12 }}>
              {files.map((f) => (
                <div key={f.name} className="list-row">
                  <input
                    type="checkbox"
                    style={{ width: 15, height: 15, marginRight: 10 }}
                    checked={!!checked[f.name]}
                    onChange={(e) => setChecked({ ...checked, [f.name]: e.target.checked })}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, wordBreak: 'break-all' }}>{f.name}</div>
                    <div className="text-faint" style={{ fontSize: 10.5 }}>{formatDate(f.created_at)}</div>
                  </div>
                  <span className="text-faint" style={{ fontSize: 11 }}>{formatBytes(f.size_bytes)}</span>
                </div>
              ))}
            </div>

            <button className="btn btn-primary btn-sm" onClick={handleDeleteSelected} disabled={deleteBusy || selectedNames.length === 0}>
              <Trash2 size={14} /> {deleteBusy ? 'Deleting…' : `Delete ${selectedNames.length} selected file(s)`}
            </button>
          </>
        )}
      </div>

      {message && <p className="text-dim" style={{ fontSize: 12.5, marginTop: 14 }}>{message}</p>}
    </div>
  )
}
