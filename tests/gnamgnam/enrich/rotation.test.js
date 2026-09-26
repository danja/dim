import { describe, it, expect } from 'vitest'
import { RotatingSummariser } from '../../../src/gnamgnam/enrich/summarise/RotatingSummariser.js'
import { defaultSummarisers } from '../../../src/gnamgnam/enrich/registry.js'

const TEXT = 'Alpha beta gamma delta. A tool for drum synthesis.'
const ok = content => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
const status = (code, headers = {}) => new Response(`HTTP ${code}`, { status: code, headers })

/**
 * Providers answer from per-host queues; a fake clock advances only when
 * the rotator sleeps, so cool-downs are exact and tests are instant.
 */
function rig (queues, env = {}, options = {}) {
  let clock = 0
  const calls = []
  const fetchImpl = async (url) => {
    const host = new URL(url).host
    calls.push(host)
    const next = queues[host]?.shift()
    if (!next) throw new Error(`no scripted reply for ${host}`)
    if (next instanceof Error) throw next
    return next
  }
  const r = RotatingSummariser.fromEnv({
    LLM_PROVIDERS: 'mistral,groq',
    MISTRAL_API_KEY: 'm',
    GROQ_API_KEY: 'g',
    ...env
  }, {
    now: () => clock,
    sleep: async ms => { clock += ms },
    memberOptions: { fetchImpl, requestIntervalMs: 0, sleep: async () => {} },
    ...options
  })
  return { r, calls, advance: ms => { clock += ms }, get clock () { return clock } }
}

const MISTRAL = 'api.mistral.ai'
const GROQ = 'api.groq.com'

describe('RotatingSummariser', () => {
  it('builds from LLM_PROVIDERS, skipping providers without a key', () => {
    const { r } = rig({}, { LLM_PROVIDERS: 'mistral, groq, openrouter', GROQ_MODEL: 'custom' })
    expect(r.id).toBe('rotate(mistral,groq)')
    expect(r.describe()).toBe('mistral:mistral-small-latest → groq:custom')
    expect(r.members[1].summariser.maxTokens).toBe(2048)
  })

  it('rejects unknown names, and a list with no usable keys', () => {
    expect(() => RotatingSummariser.fromEnv({ LLM_PROVIDERS: 'mistral,nope', MISTRAL_API_KEY: 'k' })).toThrow(/Unknown LLM provider.*nope/)
    expect(() => RotatingSummariser.fromEnv({ LLM_PROVIDERS: 'mistral,groq' })).toThrow(/MISTRAL_API_KEY/)
  })

  it('prefers the first provider and records who answered', async () => {
    const { r, calls } = rig({ [MISTRAL]: [ok('SUMMARY: From Mistral.')] })
    const out = await r.summarise(TEXT)
    expect(out.summary).toBe('From Mistral.')
    expect(out.model).toBe('remote/api.mistral.ai/mistral-small-latest-summary-v1')
    expect(calls).toEqual([MISTRAL])
  })

  it('rotates straight to the next provider on a rate limit, and cools the first down', async () => {
    const t = rig({
      [MISTRAL]: [status(429), ok('SUMMARY: Mistral again.')],
      [GROQ]: [ok('SUMMARY: From Groq.'), ok('SUMMARY: Groq again.')]
    })
    expect((await t.r.summarise(TEXT)).summary).toBe('From Groq.')
    expect(t.clock).toBe(0)
    // Still cooling (5s): the next bookmark goes to Groq too.
    expect((await t.r.summarise(TEXT)).summary).toBe('Groq again.')
    t.advance(5000)
    expect((await t.r.summarise(TEXT)).summary).toBe('Mistral again.')
    expect(t.calls).toEqual([MISTRAL, GROQ, GROQ, MISTRAL])
  })

  it('waits for the first provider back when all are cooling down', async () => {
    const t = rig({
      [MISTRAL]: [status(429, { 'retry-after': '20' }), ok('SUMMARY: Waited.')],
      [GROQ]: [status(503)]
    })
    expect((await t.r.summarise(TEXT)).summary).toBe('Waited.')
    expect(t.clock).toBe(20000)
  })

  it('gives up on a bookmark rather than wait past the limit', async () => {
    const t = rig({
      [MISTRAL]: [status(429, { 'retry-after': '120' })],
      [GROQ]: [status(429, { 'retry-after': '120' })]
    }, {}, { maxWaitMs: 60000 })
    expect(await t.r.summarise(TEXT)).toBeNull()
    expect(t.r.breaker.failures).toBe(1)
  })

  it('drops a provider whose key is refused, for the rest of the run', async () => {
    const t = rig({
      [MISTRAL]: [status(401)],
      [GROQ]: [ok('SUMMARY: One.'), ok('SUMMARY: Two.')]
    })
    await t.r.summarise(TEXT)
    await t.r.summarise(TEXT)
    expect(t.calls).toEqual([MISTRAL, GROQ, GROQ])
  })

  it('opens the breaker at once when every key is refused', async () => {
    const t = rig({ [MISTRAL]: [status(403)], [GROQ]: [status(401)] })
    expect(await t.r.summarise(TEXT)).toBeNull()
    expect(t.r.breaker.open).toBe(true)
  })

  it('tries the next provider when one gives a bad reply', async () => {
    const empty = new Response(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }), { status: 200 })
    const t = rig({ [MISTRAL]: [empty], [GROQ]: [ok('SUMMARY: Groq did it.')] })
    expect((await t.r.summarise(TEXT)).summary).toBe('Groq did it.')
  })

  it('backs off harder on repeated rate limits', async () => {
    const t = rig({ [MISTRAL]: [status(429), status(429)], [GROQ]: [ok('SUMMARY: a'), ok('SUMMARY: b')] })
    await t.r.summarise(TEXT)
    t.advance(5000)
    await t.r.summarise(TEXT)
    expect(t.r.members[0].strikes).toBe(2)
    expect(t.r.members[0].coolUntil - t.clock).toBe(10000)
  })

  it('is what --summariser remote builds when LLM_PROVIDERS is set', () => {
    const chain = defaultSummarisers('remote', { env: { LLM_PROVIDERS: 'groq', GROQ_API_KEY: 'g' }, llmOnly: true })
    expect(chain.map(s => s.id)).toEqual(['rotate(groq)'])
  })
})
