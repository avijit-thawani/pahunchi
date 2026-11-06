// Minimal service worker: makes the app installable; always fetches fresh HTML. Also shows
// "Call me later" pushes as an incoming call and opens /incoming when tapped.
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => caches.match(event.request)))
  }
})

const CALL_TAG = 'phoney-call'

self.addEventListener('push', (event) => {
  let p = { title: 'Incoming call', body: 'Tap to answer', url: '/' }
  try {
    if (event.data) p = { ...p, ...event.data.json() }
  } catch {
    // keep the defaults
  }
  event.waitUntil(self.registration.showNotification(p.title, {
    body: p.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: CALL_TAG,
    renotify: true,
    requireInteraction: true,
    vibrate: [800, 400, 800, 400, 800, 400, 800],
    data: { url: p.url },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('navigate' in c && 'focus' in c) return c.navigate(url).then(() => c.focus())
      }
      return self.clients.openWindow(url)
    }),
  )
})
