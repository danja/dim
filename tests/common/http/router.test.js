import { describe, it, expect } from 'vitest'
import Router from '../../../src/common/http/Router.js'

describe('Router', () => {
  const noop = () => {}

  it('matches exact string paths', () => {
    const router = new Router().get('/health', noop)
    expect(router.match('GET', '/health').handler).toBe(noop)
    expect(router.match('GET', '/healthz')).toBeNull()
  })

  it('hands regex matches to the handler', () => {
    const router = new Router().get(/^\/bookmark\/([a-z0-9-]+)$/, noop)
    expect(router.match('GET', '/bookmark/foo-1').match[1]).toBe('foo-1')
  })

  it('reports a known path with the wrong method', () => {
    const router = new Router().get('/x', noop)
    expect(router.match('POST', '/x')).toEqual({ methodNotAllowed: true })
  })

  it('matches in registration order', () => {
    const first = () => 1
    const router = new Router().get(/^\/a/, first).get('/ab', noop)
    expect(router.match('GET', '/ab').handler).toBe(first)
  })

  it('rejects malformed routes', () => {
    expect(() => new Router().add([], '/x', noop)).toThrow(/method/)
    expect(() => new Router().get(42, noop)).toThrow(/pattern/)
    expect(() => new Router().get('/x', null)).toThrow(/handler/)
  })
})
