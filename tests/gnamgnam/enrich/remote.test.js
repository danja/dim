import { describe, it, expect } from 'vitest'
import { RemoteSummariser } from '../../../src/gnamgnam/enrich/summarise/RemoteSummariser.js'
import { OllamaSummariser } from '../../../src/gnamgnam/enrich/summarise/OllamaSummariser.js'
import { CircuitBreaker } from '../../../src/gnamgnam/enrich/summarise/llm.js'
import { defaultSummarisers } from '../../../src/gnamgnam/enrich/registry.js'

const ENV = { LLM_BASE_URL: 'https://llm.example/v1/', LLM_API_KEY: 'k3y', LLM_MODEL: 'free-model' }
const TEXT = 'Alpha beta gamma delta. Epsilon zeta eta theta. A tool for drum synthesis.'

function reply (content, status = 200, headers = {}) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status, headers })
}

function summariser (responses, extra = {}) {
  const calls = []
  const sleeps = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next
  }
  const s = RemoteSummariser.fromEnv(ENV, { fetchImpl, sleep: async ms => { sleeps.push(ms) }, requestIntervalMs: 0, ...extra })
  return { s, calls, sleeps }
}

describe('RemoteSummariser', () => {
  it('needs its three settings', () => {
    expect(() => RemoteSummariser.fromEnv({})).toThrow(/LLM_BASE_URL/)
    expect(() => RemoteSummariser.fromEnv({ ...ENV, LLM_API_KEY: '' })).toThrow(/LLM_API_KEY/)
    expect(() => defaultSummarisers('remote', { env: {} })).toThrow(/LLM_BASE_URL/)
  })

  it('posts an OpenAI-compatible chat completion and parses the reply', async () => {
    const { s, calls } = summariser([reply('SUMMARY: A drum synthesis tool.\nKEY TERMS: drums, synthesis')])
    const out = await s.summarise(TEXT, { url: 'https://x.example/', linkText: 'X' })
    expect(calls[0].url).toBe('https://llm.example/v1/chat/completions')
    expect(calls[0].init.headers.Authorization).toBe('Bearer k3y')
    expect(calls[0].body).toMatchObject({ model: 'free-model', stream: false })
    expect(calls[0].body.messages[0].content).toMatch('SUMMARY:')
    expect(calls[0].body.messages[0].content).toMatch('drum synthesis')
    expect(out).toMatchObject({ summary: 'A drum synthesis tool.', keywords: ['drums', 'synthesis'], model: 'remote/llm.example/free-model-summary-v1' })
    expect(out.markdown).toMatch('# X')
  })

  it('waits for Retry-After on 429 and retries once', async () => {
    const { s, calls, sleeps } = summariser([
      new Response('slow down', { status: 429, headers: { 'retry-after': '7' } }),
      reply('SUMMARY: Fine now.\nKEY TERMS: ok')
    ])
    expect((await s.summarise(TEXT)).summary).toBe('Fine now.')
    expect(calls).toHaveLength(2)
    expect(sleeps).toContain(7000)
  })

  it('stops calling after an auth failure', async () => {
    const { s, calls } = summariser([new Response('no', { status: 401 })])
    expect(await s.summarise(TEXT)).toBeNull()
    expect(await s.summarise(TEXT)).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it('opens the circuit after repeated failures, and a success resets it', async () => {
    const { s, calls } = summariser([
      new Error('timeout'), reply('SUMMARY: Ok.'), new Error('t'), new Error('t'), new Error('t'), new Error('t'), new Error('t')
    ], { failureLimit: 5 })
    await s.summarise(TEXT)
    expect((await s.summarise(TEXT)).summary).toBe('Ok.')
    for (let i = 0; i < 6; i++) await s.summarise(TEXT)
    expect(calls).toHaveLength(7)
    expect(s.breaker.open).toBe(true)
  })

  it('the remote chain falls back to the offline summarisers', () => {
    expect(defaultSummarisers('remote', { env: ENV }).map(x => x.id)).toEqual([
      'remote/llm.example/free-model-summary-v1', 'mechanical-v1', 'extractive-v1'
    ])
  })
})

describe('Ollama circuit breaker', () => {
  it('stops after the failure limit', async () => {
    const s = new OllamaSummariser({ baseUrl: 'http://127.0.0.1:9', failureLimit: 2, timeoutMs: 2000 })
    for (let i = 0; i < 2; i++) expect(await s.summarise(TEXT)).toBeNull()
    expect(s.breaker.open).toBe(true)
    const started = Date.now()
    expect(await s.summarise(TEXT)).toBeNull()
    expect(Date.now() - started).toBeLessThan(50)
  })

  it('CircuitBreaker counts consecutive failures only', () => {
    const b = new CircuitBreaker({ name: 'x', limit: 2 })
    b.failure('a'); b.success(); b.failure('b')
    expect(b.open).toBe(false)
    b.failure('c')
    expect(b.open).toBe(true)
  })
})
