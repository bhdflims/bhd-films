// BHD Flims service worker.
// Two jobs only: (1) let the browser treat this site as an installable app,
// (2) receive Web Push messages sent by the supabase/functions/send-push
// Edge Function and turn them into real OS notifications.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let payload = { title: 'BHD Flims', body: 'You have a new update.', url: '/' }
  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch {
    if (event.data) payload.body = event.data.text()
  }

  const options = {
    body: payload.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: payload.url || '/' },
    vibrate: [80, 40, 80]
  }

  event.waitUntil(self.registration.showNotification(payload.title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ('focus' in client) {
          client.navigate(targetUrl)
          return client.focus()
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }
      return undefined
    })
  )
})
