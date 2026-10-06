import fs from 'fs'

/** Web App Manifest (with share target) and the service worker's source. */

export const SERVICE_WORKER = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8')

export function manifest ({ name = 'DIM', themeColor = '#2b5fae' } = {}) {
  return {
    name,
    short_name: name,
    description: "Danny's Information Manager: bookmarks, outlines, tasks, wiki, news, blog and calendar in one place.",
    id: '/squirt/',
    start_url: '/squirt/',
    scope: '/',
    display: 'standalone',
    background_color: '#fbfaf7',
    theme_color: themeColor,
    icons: [
      { src: '/static/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/static/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/static/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/static/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' }
    ],
    share_target: {
      action: '/squirt/share',
      method: 'GET',
      enctype: 'application/x-www-form-urlencoded',
      params: { title: 'title', text: 'text', url: 'url' }
    },
    shortcuts: [
      { name: 'Capture', url: '/squirt/#capture' },
      { name: 'News', url: '/news/' },
      { name: 'Tasks', url: '/farelo/' }
    ]
  }
}
