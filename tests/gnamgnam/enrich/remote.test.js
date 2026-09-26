import { describe, it, expect } from 'vitest'
import { RemoteSummariser, retryDelayMs } from '../../../src/gnamgnam/enrich/summarise/RemoteSummariser.js'
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

  it('retries 503 "high demand" with exponential backoff', async () => {
    const busy = () => new Response('{"error":{"code":503,"status":"UNAVAILABLE"}}', { status: 503 })
    const { s, calls, sleeps } = summariser([busy(), busy(), reply('SUMMARY: Third time lucky.')])
    expect((await s.summarise(TEXT)).summary).toBe('Third time lucky.')
    expect(calls).toHaveLength(3)
    expect(sleeps).toEqual([5000, 10000])
    expect(s.breaker.failures).toBe(0)
  })

  it('gives up after the retry limit and counts one failure', async () => {
    const busy = () => new Response('busy', { status: 503 })
    const { s, calls } = summariser([busy(), busy(), busy()], { maxRetries: 2 })
    expect(await s.summarise(TEXT)).toBeNull()
    expect(calls).toHaveLength(3)
    expect(s.breaker.failures).toBe(1)
  })

  it('retries network errors, but not client errors', async () => {
    const flaky = summariser([new Error('ECONNRESET'), reply('SUMMARY: Back.')])
    expect((await flaky.s.summarise(TEXT)).summary).toBe('Back.')
    const bad = summariser([new Response('bad request', { status: 400 })])
    expect(await bad.s.summarise(TEXT)).toBeNull()
    expect(bad.calls).toHaveLength(1)
  })

  it('backoff doubles, is capped, and defers to Retry-After', () => {
    const opts = { baseMs: 5000, capMs: 60000 }
    expect([1, 2, 3, 4, 5].map(a => retryDelayMs(a, opts))).toEqual([5000, 10000, 20000, 40000, 60000])
    const response = new Response('', { status: 429, headers: { 'retry-after': '3' } })
    expect(retryDelayMs(4, { ...opts, response })).toBe(3000)
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
    ], { failureLimit: 5, maxRetries: 0 })
    await s.summarise(TEXT)
    expect((await s.summarise(TEXT)).summary).toBe('Ok.')
    for (let i = 0; i < 6; i++) await s.summarise(TEXT)
    expect(calls).toHaveLength(7)
    expect(s.breaker.open).toBe(true)
  })

  it('reads LLM_MAX_TOKENS and rejects nonsense', async () => {
    const { s, calls } = summariser([reply('SUMMARY: Ok.')])
    expect(s.maxTokens).toBe(300)
    const big = RemoteSummariser.fromEnv({ ...ENV, LLM_MAX_TOKENS: '2048' }, { fetchImpl: async () => reply('SUMMARY: Ok.'), requestIntervalMs: 0 })
    expect(big.maxTokens).toBe(2048)
    expect(() => RemoteSummariser.fromEnv({ ...ENV, LLM_MAX_TOKENS: 'lots' })).toThrow(/LLM_MAX_TOKENS/)
    await s.summarise(TEXT)
    expect(calls[0].body.max_tokens).toBe(300)
  })

  it('treats a reply cut off by the token budget as a failure', async () => {
    const cut = new Response(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }), { status: 200 })
    const { s } = summariser([cut])
    expect(await s.summarise(TEXT)).toBeNull()
    expect(s.breaker.failures).toBe(1)
  })

  it('--llm-only keeps just the LLM in the chain', () => {
    expect(defaultSummarisers('remote', { env: ENV, llmOnly: true }).map(x => x.id)).toEqual(['remote/llm.example/free-model-summary-v1'])
    expect(() => defaultSummarisers('extractive', { llmOnly: true })).toThrow(/needs an LLM/)
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
