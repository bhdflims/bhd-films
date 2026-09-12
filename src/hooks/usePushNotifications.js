import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { urlBase64ToUint8Array } from '../utils/registerServiceWorker'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

// Handles the browser side of Web Push: checking support, checking the
// current permission/subscription state, and subscribing. The actual
// sending of notifications happens entirely server-side (see
// supabase/functions/send-push) - this hook never sees a private key.
export function usePushNotifications() {
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && !!VAPID_PUBLIC_KEY
  const [subscribed, setSubscribed] = useState(false)
  const [subscribing, setSubscribing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supported) return
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => {})
  }, [supported])

  const subscribe = useCallback(async () => {
    if (!supported || subscribing) return
    setError('')
    setSubscribing(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setError('Notifications permission was not granted.')
        setSubscribing(false)
        return
      }

      const registration = await navigator.serviceWorker.ready
      let sub = await registration.pushManager.getSubscription()
      if (!sub) {
        sub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        })
      }

      const json = sub.toJSON()
      const { error: rpcError } = await supabase.rpc('save_push_subscription', {
        p_endpoint: json.endpoint,
        p_p256dh: json.keys.p256dh,
        p_auth: json.keys.auth,
        p_user_agent: navigator.userAgent
      })
      if (rpcError) throw rpcError

      setSubscribed(true)
    } catch (e) {
      // On some Android phones (commonly ones without Google Play
      // Services fully set up/signed in, or with aggressive battery
      // optimization), the browser's own push registration with Google's
      // push service fails - Chrome surfaces this as an AbortError with
      // the message "Registration failed - push service error". This is
      // a device/OS-level limitation, not something wrong with the app
      // or something we can fix from here, so it gets a plainer,
      // non-alarming message instead of the raw technical error text.
      const rawMessage = e?.message || ''
      const isDevicePushServiceIssue = e?.name === 'AbortError' || /push service/i.test(rawMessage)
      setError(
        isDevicePushServiceIssue
          ? "This phone's push service isn't available right now — that's a device limitation, not an app problem. You can still see every update inside the app's bell icon any time."
          : rawMessage || 'Could not enable notifications.'
      )
    } finally {
      setSubscribing(false)
    }
  }, [supported, subscribing])

  const unsubscribe = useCallback(async () => {
    if (!supported) return
    try {
      const registration = await navigator.serviceWorker.ready
      const sub = await registration.pushManager.getSubscription()
      if (sub) {
        await supabase.rpc('remove_push_subscription', { p_endpoint: sub.endpoint })
        await sub.unsubscribe()
      }
      setSubscribed(false)
    } catch (e) {
      setError(e.message || 'Could not disable notifications.')
    }
  }, [supported])

  return { supported, subscribed, subscribing, error, subscribe, unsubscribe }
}
