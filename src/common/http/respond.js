/**
 * Response helpers shared by every facet. Dependency-free node:http,
 * CORS-open for reading (cookies are SameSite=Lax, never sent on another
 * site's fetches, so other sites never read as the owner). Nothing is cacheable by shared caches: much of what
 * DIM serves is personal (docs/security.md).
 */

export const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'private, no-cache',
  'X-Content-Type-Options': 'nosniff'
})

/** Pages load scripts, styles and fonts from DIM only, and can't be framed. */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "manifest-src 'self'",
  "worker-src 'self'"
].join('; ')

export const HTML_HEADERS = Object.freeze({
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Cache-Control': 'private, no-cache'
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

export function sendText (response, status, body, contentType, extra = {}, { cors = true } = {}) {
  response.writeHead(status, {
    'Content-Type': contentType,
    ...(cors ? { 'Access-Control-Allow-Origin': '*' } : {}),
    'Cache-Control': 'private, no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(body),
    ...extra
  })
  response.end(body)
}

/** Pages are for this origin only: no CORS, and the security headers. */
export function sendHtml (response, status, body) {
  sendText(response, status, body, 'text/html; charset=utf-8', HTML_HEADERS, { cors: false })
}

/** Escape text for HTML element content and double-quoted attributes. */
export function esc (s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function redirect (response, status, location) {
  response.writeHead(status, { Location: location, 'Content-Length': 0 })
  response.end()
}
