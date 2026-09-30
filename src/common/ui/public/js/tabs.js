/* eslint-env browser */
// Small enhancements for every page. Pages work without them.

// Scroll the current tab into view so it is never hidden off the edge.
const current = document.querySelector('.tabs [aria-current="page"]')
if (current) current.scrollIntoView({ block: 'nearest', inline: 'center' })

// Ask before destructive forms or buttons (data-confirm="…").
document.addEventListener('submit', e => {
  const message = e.submitter?.dataset.confirm ?? e.target.closest('form[data-confirm]')?.dataset.confirm
  if (message && !confirm(message)) e.preventDefault()
})

// Links that print the page (data-print).
document.addEventListener('click', e => {
  if (e.target.closest('[data-print]')) {
    e.preventDefault()
    window.print()
  }
})

// Installable app + offline reading (Squirt): the service worker lives at
// /squirt/sw.js with scope /. Needs a secure context (localhost or https).
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/squirt/sw.js', { scope: '/' }).catch(() => {})
}

// Logging out forgets the pages, news and unsent notes kept for offline use.
document.addEventListener('submit', e => {
  const form = e.target
  if (!form.matches('form[action="/logout"]') || !('caches' in window) || form.dataset.cleared) return
  e.preventDefault()
  for (const key of ['dim.offline.news', 'dim.offline.queue']) { try { localStorage.removeItem(key) } catch { /* ignore */ } }
  caches.keys()
    .then(keys => Promise.all(keys.map(k => caches.delete(k))))
    .catch(() => {})
    .finally(() => { form.dataset.cleared = '1'; form.submit() })
})
