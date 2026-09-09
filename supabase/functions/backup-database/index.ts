// BHD Films — backup-database Edge Function
//
// Runs once a day (via a pg_cron schedule, see
// supabase/cron_database_backup.sql) and exports every important table
// - customers, orders, wallet transactions, coupons, refunds, support
// tickets, etc. - into ONE JSON file, then emails that file as an
// attachment using Resend (the same email service already used for
// support-reply emails). No Google account or Drive access needed.
//
// Deploy with:  supabase functions deploy backup-database
// Secrets needed (supabase secrets set ...):
//   RESEND_API_KEY     - same key already used by send-support-email
//   RESEND_FROM_EMAIL   - e.g. "BHD Films Backups <onboarding@resend.dev>"
//   BACKUP_EMAIL_TO     - the inbox that should receive the daily backup
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically
// by the platform.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') || 'BHD Films Backups <onboarding@resend.dev>'
const BACKUP_EMAIL_TO = Deno.env.get('BACKUP_EMAIL_TO')

// Every table backed up daily. Add/remove table names here any time -
// nothing else needs to change.
const TABLES = [
  'profiles',
  'admin_users',
  'categories',
  'services',
  'orders',
  'order_items',
  'wallets',
  'wallet_transactions',
  'fund_requests',
  'refund_requests',
  'coupons',
  'coupon_redemptions',
  'offers',
  'support_tickets',
  'support_messages',
  'audit_logs'
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error('Server is missing required Supabase secrets.')
    }
    if (!RESEND_API_KEY) {
      throw new Error('Server is missing RESEND_API_KEY. See SETUP.md.')
    }
    if (!BACKUP_EMAIL_TO) {
      throw new Error('Server is missing BACKUP_EMAIL_TO. See SETUP.md.')
    }

    const authHeader = req.headers.get('Authorization') || ''
    if (authHeader !== `Bearer ${SERVICE_ROLE_KEY}`) {
      return json({ error: 'Not authorized.' }, 401)
    }

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const today = new Date().toISOString().slice(0, 10)

    const backup: Record<string, unknown> = { generated_at: new Date().toISOString(), date: today }
    const summary: Record<string, string> = {}

    for (const table of TABLES) {
      const { data, error } = await adminClient.from(table).select('*')
      if (error) {
        backup[table] = { error: error.message }
        summary[table] = `skipped: ${error.message}`
        continue
      }
      backup[table] = data || []
      summary[table] = `ok (${(data || []).length} rows)`
    }

    const jsonText = JSON.stringify(backup, null, 2)
    const fileName = `bhd-films-backup-${today}.json`
    const attachmentBase64 = toBase64(jsonText)

    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [BACKUP_EMAIL_TO],
        subject: `BHD Films Daily Backup — ${today}`,
        html: renderEmailHtml({ date: today, summary }),
        attachments: [{ filename: fileName, content: attachmentBase64 }]
      })
    })

    if (!resendResp.ok) {
      const errText = await resendResp.text().catch(() => '')
      throw new Error(`Resend API error (${resendResp.status}): ${errText}`)
    }

    return json({ status: 'sent', date: today, results: summary })
  } catch (err) {
    return json({ error: err?.message || 'Unexpected error.' }, 500)
  }
})

// Encodes a (possibly unicode) string to base64, the format Resend's
// attachments.content field expects.
function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function renderEmailHtml({ date, summary }: { date: string; summary: Record<string, string> }) {
  const rows = Object.entries(summary)
    .map(
      ([table, status]) =>
        `<tr><td style="padding:4px 0; color:#8b8494;">${table}</td><td style="padding:4px 0; text-align:right; color:#c9c4d4;">${status}</td></tr>`
    )
    .join('')
  return `
  <div style="font-family: Arial, Helvetica, sans-serif; background:#0c0a10; padding:32px 16px; color:#e8e4f0;">
    <div style="max-width:480px; margin:0 auto; background:#15121c; border-radius:16px; padding:28px; border:1px solid #2a2433;">
      <p style="margin:0 0 4px; font-size:12px; letter-spacing:1px; color:#d4af37; text-transform:uppercase;">BHD Films Backups</p>
      <h1 style="margin:0 0 18px; font-size:19px; color:#fff;">Daily Backup — ${date}</h1>
      <p style="margin:0 0 14px; font-size:14px; line-height:1.6; color:#c9c4d4;">Your full database backup is attached as a JSON file. Keep it somewhere safe (e.g. a folder on your computer or a cloud drive).</p>
      <table style="width:100%; font-size:13px; margin-bottom:6px;">${rows}</table>
    </div>
  </div>`
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  })
}
