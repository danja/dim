import { describe, it, expect } from 'vitest'
import { Readable } from 'stream'
import Auth, { safeEqual, parseCookies, SESSION_COOKIE } from '../../../src/common/http/auth.js'
import { readBody, wantsJson } from '../../../src/common/http/body.js'
import { safeReturn } from '../../../src/common/http/write.js'

const TOKEN = 'test-token-0123456789abcdef'
const req = (headers = {}) => ({ headers })

describe('Auth', () => {
  it('compares in constant time and parses cookies', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', undefined)).toBe(false)
    expect(parseCookies('a=1; dim_session=x%20y')).toEqual({ a: '1', dim_session: 'x y' })
  })

  it('refuses a short token and disables writes without one', () => {
    expect(() => new Auth({ token: 'short' })).toThrow(/16/)
    const off = new Auth()
    expect(off.writesEnabled).toBe(false)
    expect(off.authorise(req({ authorization: `Bearer ${TOKEN}` }))).toMatchObject({ ok: false, status: 403 })
  })

  it('accepts the token as Bearer or as the Basic password', () => {
    const auth = new Auth({ token: TOKEN })
    expect(auth.identify(req({ authorization: `Bearer ${TOKEN}` }))).toMatchObject({ user: 'owner', via: 'bearer' })
    const basic = Buffer.from(`anyone:${TOKEN}`).toString('base64')
    expect(auth.identify(req({ authorization: `Basic ${basic}` }))).toMatchObject({ user: 'owner', via: 'basic' })
    expect(auth.identify(req({ authorization: 'Bearer nope' })).user).toBeNull()
    expect(auth.authorise(req({}))).toMatchObject({ ok: false, status: 401 })
  })

  it('sessions need the CSRF token for every write', () => {
    const auth = new Auth({ token: TOKEN })
    const cookie = auth.login()
    expect(cookie).toMatch(/HttpOnly; SameSite=Strict/)
    const id = cookie.split(';')[0].split('=')[1]
    const request = req({ cookie: `${SESSION_COOKIE}=${id}` })
    const { csrf } = auth.identify(request)
    expect(csrf).toBeTruthy()
    expect(auth.authorise(request, {})).toMatchObject({ ok: false, status: 403 })
    expect(auth.authorise(request, { _csrf: 'wrong' })).toMatchObject({ ok: false, status: 403 })
    expect(auth.authorise(request, { _csrf: csrf }).ok).toBe(true)
    expect(auth.logout(request)).toMatch(/Max-Age=0/)
    expect(auth.identify(request).user).toBeNull()
  })

  it('expires sessions', () => {
    let now = 0
    const auth = new Auth({ token: TOKEN, now: () => now })
    const id = auth.login().split(';')[0].split('=')[1]
    now = 31 * 24 * 3600 * 1000
    expect(auth.identify(req({ cookie: `${SESSION_COOKIE}=${id}` })).user).toBeNull()
  })
})

describe('request bodies', () => {
  const body = (content, type) => Object.assign(Readable.from([Buffer.from(content)]), { headers: { 'content-type': type } })

  it('reads forms (repeated keys as arrays) and JSON objects', async () => {
    expect(await readBody(body('a=1&b=x+y&a=2', 'application/x-www-form-urlencoded'))).toEqual({ a: ['1', '2'], b: 'x y' })
    expect(await readBody(body('{"tags":"x"}', 'application/json; charset=utf-8'))).toEqual({ tags: 'x' })
  })

  it('refuses other types, bad JSON and oversize bodies', async () => {
    await expect(readBody(body('x', 'text/plain'))).rejects.toMatchObject({ status: 415 })
    await expect(readBody(body('[1]', 'application/json'))).rejects.toMatchObject({ status: 400 })
    await expect(readBody(body('x'.repeat(100), 'application/json'), { maxBytes: 10 })).rejects.toMatchObject({ status: 413 })
  })

  it('tells JSON clients from forms', () => {
    expect(wantsJson(req({ 'content-type': 'application/json' }))).toBe(true)
    expect(wantsJson(req({ 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html,*/*' }))).toBe(false)
  })

  it('only redirects back to local paths', () => {
    expect(safeReturn('/gnamgnam/bookmark/x')).toBe('/gnamgnam/bookmark/x')
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil', 'javascript:x', '', undefined]) {
      expect(safeReturn(bad, '/home'), String(bad)).toBe('/home')
    }
  })

  it('ignores a malformed cookie rather than throwing', () => {
    const auth = new Auth({ token: 'test-token-0123456789abcdef' })
    expect(parseCookies('other=%E0%A4%A; dim_session=abc')).toEqual({ dim_session: 'abc' })
    expect(auth.identify({ headers: { cookie: 'other=%E0%A4%A' } })).toMatchObject({ user: null })
  })
})
