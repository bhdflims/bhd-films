// BHD Films — send-push Edge Function
//
// This is the ONLY place that ever touches the VAPID *private* key, and the
// only place allowed to read every row of push_subscriptions (it uses the
// service-role key, which never leaves the server). The browser can never
// send a push notification directly - it can only ask this function to.
//
// Who is allowed to call this:
//   1. A logged-in BHD Films admin (checked via their JWT + admin_users,
//      same role/permission rules as the rest of the admin panel), for the
//      "Notify Customers" buttons on Offers / Rate Control.
//   2. The daily "Good Morning" pg_cron job, authenticated with the
//      project's service-role key (see supabase/cron_good_morning.sql).
//   3. Database triggers that fire on a new order / new support message,
//      also using the service-role key, with audience = "admins" so only
//      admin devices (not customers) get pinged (see
//      supabase/migration_007_admin_notifications.sql).
//
// Deploy with:  supabase functions deploy send-push
// Secrets needed (supabase secrets set ...): VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT. SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY are provided automatically by the platform.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4'
import webpush from 'npm:web-push@3.6.7'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
// Trim in case the key was copy-pasted into the Supabase Secrets form with
// a stray leading/trailing space or line break - easy to do by accident,
// and web-push's own validation rejects a key with even one extra
// character, which used to crash this ENTIRE function (see below).
const VAPID_PUBLIC_KEY = (Deno.env.get('VAPID_PUBLIC_KEY') || '').trim()
const VAPID_PRIVATE_KEY = (Deno.env.get('VAPID_PRIVATE_KEY') || '').trim()
const VAPID_SUBJECT = (Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com').trim()

// IMPORTANT: this used to call webpush.setVapidDetails(...) here, at the
// top of the file, outside of any try/catch. If the VAPID keys were ever
// missing or even slightly malformed, that call threw immediately while
// the function was still starting up - which crashed the WHOLE function
// before it could even look at the incoming request, for every single
// call, with no useful error message (Supabase just reports a generic
// "non-2xx status code" and the function's own logs show a bare
// "shutdown" / "EarlyDrop", no actual error text). Moving it inside the
// request handler, wrapped in the same try/catch as everything else,
// means a bad key now produces a proper, readable error response instead
// of silently taking down the function.
let vapidReady = false
function ensureVapidConfigured() {
  if (vapidReady) return
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  vapidReady = true
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      throw new Error('Server is missing required secrets. See SETUP.md.')
    }
    try {
      ensureVapidConfigured()
    } catch (vapidErr) {
      throw new Error(
        `VAPID keys are set but invalid (${vapidErr?.message || 'unknown reason'}). ` +
          'Double-check VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Supabase Edge Function Secrets for extra spaces or missing characters.'
      )
    }

    const authHeader = req.headers.get('Authorization') || ''
    const isServiceRoleCall = authHeader === `Bearer ${SERVICE_ROLE_KEY}`

    // Service-role client - bypasses RLS. Only used for reads/writes this
    // function itself needs (subscriptions), never exposed to the caller.
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    if (!isServiceRoleCall) {
      // Must be a logged-in admin. Verify using THEIR token (RLS-respecting
      // client), not the service-role one, so we never trust the frontend.
      if (!SUPABASE_ANON_KEY) throw new Error('Missing SUPABASE_ANON_KEY.')
      const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } }
      })
      const { data: userData, error: userError } = await callerClient.auth.getUser()
      if (userError || !userData?.user) {
        return json({ error: 'Not authenticated.' }, 401)
      }
      const { data: adminRow } = await callerClient.from('admin_users').select('role').eq('id', userData.user.id).maybeSingle()
      if (!adminRow) {
        return json({ error: 'Not authorized.' }, 403)
      }
    }

    const body = await req.json().catch(() => ({}))
    const title = String(body.title || 'BHD Films').slice(0, 120)
    const message = String(body.body || '').slice(0, 500)
    const url = String(body.url || '/').slice(0, 300)
    const audience = body.audience === 'user' ? 'user' : body.audience === 'admins' ? 'admins' : 'all'
    const userId = body.userId || null

    if (!message) {
      return json({ error: 'Notification body is required.' }, 400)
    }
    if (audience === 'user' && !userId) {
      return json({ error: 'userId is required when audience is "user".' }, 400)
    }

    let query = adminClient.from('push_subscriptions').select('id, endpoint, p256dh, auth')
    if (audience === 'user') {
      query = query.eq('user_id', userId)
    } else if (audience === 'admins') {
      // Only send to devices belonging to logged-in admin accounts.
      const { data: adminRows, error: adminErr } = await adminClient.from('admin_users').select('id')
      if (adminErr) throw adminErr
      const adminIds = (adminRows || []).map((a) => a.id)
      if (adminIds.length === 0) {
        return json({ sent: 0, removed: 0, failed: 0, total: 0 })
      }
      query = query.in('user_id', adminIds)
    }
    const { data: subscriptions, error: subError } = await query
    if (subError) throw subError

    const payload = JSON.stringify({ title, body: message, url })

    let sent = 0
    let removed = 0
    let failed = 0

    await Promise.all(
      (subscriptions || []).map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          )
          sent++
        } catch (err) {
          const statusCode = err?.statusCode
          if (statusCode === 404 || statusCode === 410) {
            // Subscription is gone (user uninstalled / cleared data) - clean it up.
            await adminClient.from('push_subscriptions').delete().eq('id', sub.id)
            removed++
          } else {
            failed++
          }
        }
      })
    )

    return json({ sent, removed, failed, total: (subscriptions || []).length })
  } catch (err) {
    return json({ error: err?.message || 'Unexpected error.' }, 500)
  }
})

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  })
}
