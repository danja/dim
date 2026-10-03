/* eslint-env serviceworker */
// DIM's service worker (served at /squirt/sw.js, scope /). Network first,
// so what you see is current; the last copy of each page you opened is
// kept for reading offline. Writes, logins and non-GETs are never cached.
// Logging out clears the cache (tabs.js).

const CACHE = 'dim-v1'
const OFFLINE = '/squirt/offline'
const MAX_ENTRIES = 300
const NEVER = /^\/(login|logout)\b|^\/squirt\/(capture|sw\.js)/

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([OFFLINE, '/squirt/', '/static/css/base.css', '/static/js/tabs.js'])).then(() => self.skipWaiting()))
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
  event.respondWith((async () => {
    try {
      const response = await fetch(request)
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE)
        await cache.put(request, response.clone())
        trim(cache)
      }
      return response
    } catch (error) {
      const cached = await caches.match(request, { ignoreSearch: url.pathname === '/squirt/share' })
      if (cached) return cached
      if (request.mode === 'navigate') return (await caches.match(OFFLINE)) ?? Response.error()
      throw error
    }
  })())
})
