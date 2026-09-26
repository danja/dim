/**
 * Response helpers shared by every facet. Dependency-free node:http,
 * CORS-open (CC0 catalogue data).
 */

export const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, max-age=60'
})

export const LICENCE = Object.freeze({
  licence: 'CC0-1.0',
  url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  attribution: 'DIM — Danny\'s Information Manager (requested, not required)'
})

export function send (response, status, body) {
  const payload = JSON.stringify(body, null, 2)
  response.writeHead(status, { ...JSON_HEADERS, 'Content-Length': Buffer.byteLength(payload) })
  response.end(payload)
}

export function sendText (response, status, body, contentType) {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(body)
  })
  response.end(body)
}

export function sendHtml (response, status, body) {
  sendText(response, status, body, 'text/html; charset=utf-8')
}

/** Escape text for HTML element content and double-quoted attributes. */
export function esc (s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function redirect (response, status, location) {
  response.writeHead(status, { Location: location, 'Content-Length': 0 })
  response.end()
}
