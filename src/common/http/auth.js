import { randomBytes, timingSafeEqual, createHash } from 'crypto'

/**
 * Who may write. DIM is single-user and runs on localhost, so there is one
 * secret: DIM_WRITE_TOKEN from .env. Reads stay open.
 *
 *   - Scripts: `Authorization: Bearer <token>`, or HTTP Basic with the token
 *     as the password (any user name).
 *   - Browser: POST /login with the token sets a session cookie (HttpOnly,
 *     SameSite=Strict). Every form then carries a per-session CSRF token,
 *     checked on each write — the cookie alone never authorises one.
 *
 * With no DIM_WRITE_TOKEN, writes are disabled (every write answers 403 and
 * says why) rather than open.
 */

export const SESSION_COOKIE = 'dim_session'
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000
export const MIN_TOKEN_LENGTH = 16

function digest (value) {
  return createHash('sha256').update(String(value), 'utf8').digest()
}

/** Constant-time string comparison (hashing first equalises lengths). */
export function safeEqual (a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  return timingSafeEqual(digest(a), digest(b))
}

export function parseCookies (header = '') {
  const out = {}
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).trim()
    if (key) out[key] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return out
}

export class Auth {
  constructor ({ token = null, now = () => Date.now(), secureCookie = false } = {}) {
    if (token && token.length < MIN_TOKEN_LENGTH) {
      throw new Error(`DIM_WRITE_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`)
    }
    this.token = token || null
    this.now = now
    this.secureCookie = secureCookie
    this.sessions = new Map()
  }

  static fromEnv (env = process.env) {
    return new Auth({ token: env.DIM_WRITE_TOKEN || null })
  }

  get writesEnabled () {
    return Boolean(this.token)
  }

  /** Check a presented token. */
  verify (candidate) {
    return this.writesEnabled && safeEqual(String(candidate ?? ''), this.token)
  }

  /**
   * Who is asking. → { user, via, csrf }
   *   via: 'bearer' | 'basic' | 'session' | null
   */
  identify (request) {
    const header = String(request.headers.authorization ?? '')
    if (header.startsWith('Bearer ')) {
      return this.verify(header.slice(7).trim()) ? { user: 'owner', via: 'bearer', csrf: null } : { user: null, via: null, csrf: null }
    }
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8')
      const password = decoded.slice(decoded.indexOf(':') + 1)
      return this.verify(password) ? { user: 'owner', via: 'basic', csrf: null } : { user: null, via: null, csrf: null }
    }
    const id = parseCookies(request.headers.cookie)[SESSION_COOKIE]
    const session = id ? this.sessions.get(id) : null
    if (session && session.expires > this.now() && this.writesEnabled) {
      return { user: 'owner', via: 'session', csrf: session.csrf }
    }
    if (session) this.sessions.delete(id)
    return { user: null, via: null, csrf: null }
  }

  /**
   * May this request write? Header credentials suffice; a session also
   * needs the matching CSRF token from the body (`_csrf`) or X-CSRF-Token.
   * → { ok: true, identity } | { ok: false, status, error }
   */
  authorise (request, body = {}) {
    if (!this.writesEnabled) {
      return { ok: false, status: 403, error: 'Writes are disabled: set DIM_WRITE_TOKEN in .env and restart' }
    }
    const identity = this.identify(request)
    if (!identity.user) return { ok: false, status: 401, error: 'Log in, or send the write token' }
    if (identity.via === 'session') {
      const presented = body._csrf ?? request.headers['x-csrf-token']
      if (!safeEqual(String(presented ?? ''), identity.csrf)) {
        return { ok: false, status: 403, error: 'Missing or stale form token; reload the page and try again' }
      }
    }
    return { ok: true, identity }
  }

  /** Start a browser session. → Set-Cookie header value. */
  login () {
    const id = randomBytes(32).toString('base64url')
    this.sessions.set(id, { csrf: randomBytes(24).toString('base64url'), expires: this.now() + SESSION_TTL_MS })
    return this.#cookie(id, Math.floor(SESSION_TTL_MS / 1000))
  }

  logout (request) {
    const id = parseCookies(request.headers.cookie)[SESSION_COOKIE]
    if (id) this.sessions.delete(id)
    return this.#cookie('', 0)
  }

  #cookie (value, maxAge) {
    return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${this.secureCookie ? '; Secure' : ''}`
  }
}

export default Auth
