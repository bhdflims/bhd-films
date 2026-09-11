import { useEffect, useState } from 'react'
import JSZip from 'jszip'
import { HardDrive, Trash2, RefreshCw, Download, Lock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Loader from '../../components/common/Loader'
import { formatBytes, formatDate } from '../../utils/format'
import { useAuth } from '../../context/AuthContext'

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
  const { isSuperAdmin } = useAuth()
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
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupProgress, setBackupProgress] = useState('')

  async function loadSummary() {
    setLoading(true)
    setMessage('')
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
    try {
      // Deleting via storage.objects directly (the old storage_delete_qr_orphans
      // RPC) only ever removed the catalog row - it never told Supabase's
      // actual storage backend to free the real file bytes, so "Total
      // space used" never went down. supabase.storage.remove() is the
      // real delete: it removes the file itself AND its catalog row in
      // one call. See migration_017 for the RLS policy that allows this.
      const names = qrOrphans.map((f) => f.name)
      const { error } = await supabase.storage.from('payment-qr').remove(names)
      if (error) throw error
      // storage.objects deletions don't get an automatic audit trigger the
      // way table edits do, so this logs it explicitly - this is a
      // super-admin-only action and needs to show up in the Audit Log with
      // who did it, same as any other destructive/money-moving change.
      await supabase.rpc('log_storage_deletion', {
        p_bucket: 'payment-qr',
        p_names: names,
        p_freed_bytes: qrOrphanBytes
      })
      setMessage(`Deleted ${names.length} old QR image(s), freed ${formatBytes(qrOrphanBytes)}.`)
      loadSummary()
    } catch (e) {
      setMessage(e.message || 'Could not delete these files. Please try again.')
    } finally {
      setQrBusy(false)
    }
  }

  async function loadFiles() {
    setFilesLoading(true)
    setChecked({})
    setMessage('')
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

  // Downloads a .zip containing the actual selected images (not just their
  // names) plus a manifest.json describing each one, so an admin has a real
  // backup on their own computer before anything is permanently deleted.
  // Nothing is deleted by this - it's purely a safety net for "just in case
  // we need it again later".
  async function handleDownloadBackup() {
    if (selectedNames.length === 0) return
    setBackupBusy(true)
    setMessage('')
    try {
      const zip = new JSZip()
      const manifest = []
      for (let i = 0; i < selectedNames.length; i++) {
        const name = selectedNames[i]
        setBackupProgress(`Downloading ${i + 1} of ${selectedNames.length}…`)
        const { data: signed } = await supabase.storage.from(selectedBucket).createSignedUrl(name, 300)
        if (!signed?.signedUrl) continue
        const res = await fetch(signed.signedUrl)
        if (!res.ok) continue
        const blob = await res.blob()
        // Flatten "userid/1699999999-file.jpg" into a safe filename inside
        // the zip so it doesn't try to create folders.
        zip.file(name.replace(/\//g, '__'), blob)
        const meta = files.find((f) => f.name === name)
        manifest.push({ bucket: selectedBucket, path: name, size_bytes: meta?.size_bytes ?? blob.size, uploaded_at: meta?.created_at ?? null })
      }
      if (manifest.length === 0) {
        setMessage('Could not download any of the selected files for backup.')
        return
      }
      zip.file('manifest.json', JSON.stringify(manifest, null, 2))
      const content = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(content)
      const a = document.createElement('a')
      a.href = url
      a.download = `bhd-films-backup-${selectedBucket}-${Date.now()}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setMessage(`Backup downloaded — ${manifest.length} of ${selectedNames.length} file(s) saved to your Downloads folder. Now safe to delete if you want to.`)
    } catch (e) {
      setMessage(e.message || 'Could not create the backup.')
    } finally {
      setBackupBusy(false)
      setBackupProgress('')
    }
  }

  async function handleDeleteSelected() {
    if (selectedNames.length === 0) return
    if (
      !window.confirm(
        `Delete ${selectedNames.length} file(s), freeing ${formatBytes(selectedBytes)}?\n\nIf any of these belong to an old support ticket or refund, that record will still show up in history but its photo will no longer open. This cannot be undone — use "Download Backup" first if you might need these again.`
      )
    ) {
      return
    }
    setDeleteBusy(true)
    setMessage('')
    try {
      // Same fix as the QR cleanup above: go through the real Storage API
      // (supabase.storage.remove) instead of the old storage_delete_files
      // RPC, which only deleted the catalog row via raw SQL and left the
      // actual file sitting in the bucket, still counted against your
      // Supabase storage quota even though it had "disappeared" from here.
      const names = [...selectedNames]
      const bytes = selectedBytes
      const { error } = await supabase.storage.from(selectedBucket).remove(names)
      if (error) throw error
      // Same audit-logging as the QR cleanup above - storage deletions have
      // no automatic trigger, so this records it manually for the Audit Log.
      await supabase.rpc('log_storage_deletion', {
        p_bucket: selectedBucket,
        p_names: names,
        p_freed_bytes: bytes
      })
      setMessage(`Deleted ${names.length} file(s), freed ${formatBytes(bytes)}.`)
      loadFiles()
      loadSummary()
    } catch (e) {
      setMessage(e.message || 'Could not delete these files. Please try again.')
    } finally {
      setDeleteBusy(false)
    }
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
        ) : isSuperAdmin ? (
          <button className="btn btn-primary btn-sm" onClick={handleDeleteQrOrphans} disabled={qrBusy}>
            <Trash2 size={14} /> {qrBusy ? 'Deleting…' : `Delete ${qrOrphans.length} old QR image(s) (${formatBytes(qrOrphanBytes)})`}
          </button>
        ) : (
          <p className="text-faint" style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Lock size={12} /> Only a Super Admin can delete files.
          </p>
        )}
      </div>

      <div className="surface-card">
        <strong style={{ fontSize: 13.5 }}>Review &amp; delete old screenshots by hand</strong>
        <p className="text-faint" style={{ fontSize: 11.5, margin: '6px 0 12px' }}>
          These photos are linked to support tickets and refund requests, even old resolved ones. Deleting a
          file here does <strong>not</strong> delete the ticket or refund itself — it just means that old record's
          photo can no longer be opened. Only delete ones you're sure you won't need to look back at.
        </p>

        <div style={{ marginBottom: 10 }}>
          <span className="field-label">Bucket</span>
          <select value={selectedBucket} onChange={(e) => setSelectedBucket(e.target.value)}>
            {BROWSABLE_BUCKETS.map((b) => (
              <option key={b.id} value={b.id}>{b.label}</option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: 12 }}>
          <span className="field-label">Uploaded before (optional)</span>
          <input type="date" value={beforeDate} onChange={(e) => setBeforeDate(e.target.value)} />
        </div>
        <button className="btn btn-secondary btn-sm" style={{ marginBottom: 14 }} onClick={loadFiles} disabled={filesLoading}>
          {filesLoading ? 'Loading…' : 'Apply Filter'}
        </button>

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

            <p className="text-faint" style={{ fontSize: 11, margin: '0 0 8px' }}>
              Not sure? Download a backup first — it saves the actual photos to your computer as a .zip file,
              so you'll still have them even after deleting from here.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn btn-secondary btn-sm" onClick={handleDownloadBackup} disabled={backupBusy || selectedNames.length === 0}>
                <Download size={14} /> {backupBusy ? (backupProgress || 'Preparing…') : `Download Backup (${selectedNames.length})`}
              </button>
              {isSuperAdmin ? (
                <button className="btn btn-primary btn-sm" onClick={handleDeleteSelected} disabled={deleteBusy || selectedNames.length === 0}>
                  <Trash2 size={14} /> {deleteBusy ? 'Deleting…' : `Delete ${selectedNames.length} selected file(s)`}
                </button>
              ) : (
                <span className="text-faint" style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Lock size={12} /> Only a Super Admin can delete files.
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {message && <p className="text-dim" style={{ fontSize: 12.5, marginTop: 14 }}>{message}</p>}
    </div>
  )
}
