/* eslint-env serviceworker */
// DIM's service worker (served at /squirt/sw.js, scope /). Network first,
// so what you see is current; the last copy of each page you opened is
// kept for reading offline. Writes, logins and non-GETs are never cached.
// Logging out clears the cache (tabs.js).
//
// A dead link (wifi with no route, a VPN that is down) doesn't refuse the
// connection, it just never answers, and a browser can wait minutes. So
// after WAIT_MS with a saved copy in hand, that copy is shown and the request
// carries on in the background to refresh it. With no copy it keeps waiting.

const CACHE = 'dim-v1'
const OFFLINE = '/squirt/offline'
const MAX_ENTRIES = 300
const WAIT_MS = 4000
const NEVER = /^\/(login|logout)\b|^\/squirt\/(capture|sw\.js)/

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([OFFLINE, '/squirt/', '/static/css/base.css', '/static/css/squirt.css', '/static/js/tabs.js', '/static/js/offline.js', '/static/js/offlineQueue.js'])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()))
})

async function trim (cache) {
  const keys = await cache.keys()
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) await cache.delete(key)
}

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || NEVER.test(url.pathname)) return
  const network = fetch(request).then(async response => {
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(CACHE)
      await cache.put(request, response.clone())
      trim(cache)
    }
    return response
  })
  network.catch(() => {}) // answered below, or abandoned; never an unhandled rejection
  event.waitUntil(network.catch(() => {})) // let a slow answer finish refreshing the copy
  const saved = () => caches.match(request, { ignoreSearch: url.pathname === '/squirt/share' })
  event.respondWith((async () => {
    const slow = Symbol('slow')
    try {
      const first = await Promise.race([network, new Promise(resolve => setTimeout(resolve, WAIT_MS, slow))])
      if (first !== slow) return first
      return (await saved()) ?? await network
    } catch (error) {
      const cached = await saved()
      if (cached) return cached
      if (request.mode === 'navigate') return (await caches.match(OFFLINE)) ?? Response.error()
      throw error
    }
  })())
})
