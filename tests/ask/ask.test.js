import http from 'http'
import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from '../../src/server.js'
import Auth from '../../src/common/http/auth.js'
import { createAskFacet } from '../../src/ask/index.js'
import { answer, userMessage, historyMessages } from '../../src/ask/answer.js'
import { askProviders } from '../../src/ask/providers.js'
import { answerHtml, renderTurn } from '../../src/ask/render.js'
import { parseTune, changes, tune } from '../../src/common/rag/options.js'

const TOKEN = 'test-token-0123456789abcdef'
const DIM = 'http://purl.org/stuff/dim/'
const JSON_AUTH = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' }

const notes = {
  id: 'notes',
  label: 'Notes',
  types: { page: '/notes/' },
  routes () {},
  async find () { return [{ iri: `${DIM}page/synth`, label: 'Synth <DIY>', href: '/notes/synth', snippet: 'x' }] },
  async lookup (iri) { return iri.endsWith('/synth') ? { label: 'Synth <DIY>', href: '/notes/synth', type: 'page' } : null },
  async passage (iri) { return iri.endsWith('/synth') ? { text: 'Build a modular synth from kits.' } : null }
}

const retrieval = { query: 'q', items: [{ iri: 'i', label: 'Synth <DIY>', href: '/notes/synth', facet: 'notes', facetLabel: 'Notes', score: 0.9, hops: 0, seed: true, via: [], text: 'Build a modular synth.' }], edges: [], communities: [], semanticError: null }

const local = { name: 'ollama', kind: 'ollama', baseUrl: 'http://ollama:11434/', model: 'qwen', maxTokens: 100, remote: false }
const hosted = (name, extra = {}) => ({ name, kind: 'openai', baseUrl: `https://${name}.example/v1/`, apiKey: 'k', model: 'big', maxTokens: 100, remote: true, ...extra })
const reply = (content, shape = 'openai') => ({ ok: true, json: async () => shape === 'ollama' ? { message: { content } } : { choices: [{ message: { content } }] } })
const status = (code, headers = {}) => ({ ok: false, status: code, headers: { get: k => headers[k] ?? null } })

describe('answer', () => {
  it('sends sources, earlier turns and the question to Ollama chat', async () => {
    let sent
    const fetchFn = async (url, init) => {
      sent = { url, body: JSON.parse(init.body) }
      return reply(' Use kits [1]. ', 'ollama')
    }
    const out = await answer({ providers: [local], question: 'How?', retrieval, history: [{ q: 'before', a: 'earlier' }], fetchFn })
    expect(out).toEqual({ text: 'Use kits [1].', by: 'ollama/qwen' })
    expect(sent.url).toBe('http://ollama:11434/api/chat')
    expect(sent.body.stream).toBe(false)
    expect(sent.body.messages.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(sent.body.messages[3].content).toContain('[1] Synth <DIY> (Notes)')
    expect(sent.body.messages[3].content).toContain('Question: How?')
  })

  it('uses an OpenAI-compatible API with a bearer key', async () => {
    let sent
    const fetchFn = async (url, init) => {
      sent = { url, headers: init.headers, body: JSON.parse(init.body) }
      return reply('Remote [1]')
    }
    expect(await answer({ providers: [hosted('mistral')], question: 'How?', retrieval, fetchFn })).toEqual({ text: 'Remote [1]', by: 'mistral/big' })
    expect(sent.url).toBe('https://mistral.example/v1/chat/completions')
    expect(sent.headers.Authorization).toBe('Bearer k')
    expect(sent.body.max_tokens).toBe(100)
  })

  it('rotates: a rate-limited provider cools off, a refused one is dropped, the next answers', async () => {
    const calls = []
    const fetchFn = async url => {
      calls.push(url.split('/')[2])
      if (url.includes('groq')) return status(429, { 'retry-after': '30' })
      if (url.includes('mistral')) return status(401)
      return reply('From the third')
    }
    const providers = [hosted('mistral'), hosted('groq'), hosted('openrouter')]
    const state = new Map()
    let clock = 0
    const now = () => clock
    expect(await answer({ providers, state, question: 'x', retrieval, fetchFn, now })).toEqual({ text: 'From the third', by: 'openrouter/big' })
    expect(calls).toEqual(['mistral.example', 'groq.example', 'openrouter.example'])
    expect(state.get('mistral')).toEqual({ dropped: true })
    expect(state.get('groq').coolUntil).toBe(30000)
    calls.length = 0
    await answer({ providers, state, question: 'x', retrieval, fetchFn, now })
    expect(calls).toEqual(['openrouter.example']) // mistral dropped, groq cooling
    calls.length = 0
    clock = 31000
    await answer({ providers, state, question: 'x', retrieval, fetchFn, now })
    expect(calls).toEqual(['groq.example', 'openrouter.example']) // groq back, asked first again
  })

  it('reports every failure when no provider can answer', async () => {
    const out = await answer({ providers: [hosted('mistral'), local], question: 'x', retrieval, fetchFn: async url => { if (url.includes('mistral')) return status(503); throw new Error('refused') } })
    expect(out.error).toContain('mistral: HTTP 503')
    expect(out.error).toContain('ollama: refused')
    expect((await answer({ providers: [], question: 'x', retrieval })).error).toMatch(/ASK_PROVIDERS/)
    expect((await answer({ providers: [local], question: 'x', retrieval, fetchFn: async () => status(404) })).error).toMatch(/available/)
    expect((await answer({ providers: [local], question: 'x', retrieval, fetchFn: async () => reply('', 'ollama') })).error).toMatch(/empty/)
  })

  it('says when nothing was found, and trims and ignores bad history', () => {
    expect(userMessage('q', { items: [] })).toContain('No sources were found.')
    expect(historyMessages('nope')).toEqual([])
    expect(historyMessages([1, 2, 3, 4, 5, 6].map(i => ({ q: `q${i}`, a: `a${i}` }))).length).toBe(8)
  })
})

describe('askProviders', () => {
  it('defaults to Ollama alone, and to nothing without OLLAMA_URL', () => {
    expect(askProviders({ OLLAMA_URL: 'http://o:11434' }).map(p => `${p.name}/${p.model}/${p.remote}`)).toEqual(['ollama/qwen2.5:3b/false'])
    expect(askProviders({})).toEqual([])
  })

  it('builds the named hosted providers in order from the shared key names, skipping unkeyed ones', () => {
    const list = askProviders({ ASK_PROVIDERS: 'mistral, groq,ollama,openrouter', MISTRAL_API_KEY: 'a', GROQ_API_KEY: 'b', GROQ_MODEL: 'llama', GROQ_MAX_TOKENS: '900', OLLAMA_URL: 'http://o', ASK_MODEL: 'tiny' })
    expect(list.map(p => `${p.name}/${p.model}`)).toEqual(['mistral/mistral-small-latest', 'groq/llama', 'ollama/tiny'])
    expect(list[1]).toMatchObject({ remote: true, maxTokens: 900, baseUrl: 'https://api.groq.com/openai/v1' })
    expect(list[0].maxTokens).toBe(700)
  })

  it('supports a custom endpoint and refuses mistakes', () => {
    const custom = askProviders({ ASK_PROVIDERS: 'custom', CUSTOM_API_KEY: 'k', CUSTOM_BASE_URL: 'https://x/v1', CUSTOM_MODEL: 'm' })
    expect(custom[0]).toMatchObject({ name: 'custom', baseUrl: 'https://x/v1', model: 'm' })
    expect(() => askProviders({ ASK_PROVIDERS: 'custom', CUSTOM_API_KEY: 'k' })).toThrow(/CUSTOM_BASE_URL/)
    expect(() => askProviders({ ASK_PROVIDERS: 'nope' })).toThrow(/Unknown/)
    expect(() => askProviders({ ASK_PROVIDERS: 'groq' })).toThrow(/None of ASK_PROVIDERS/)
  })
})

describe('rendering', () => {
  it('escapes everything and links only citations that exist', () => {
    expect(answerHtml('See <b>[1]</b> and [7]', 2, 3)).toBe('See &lt;b&gt;<a class="cite" href="#src-2-1">[1]</a>&lt;/b&gt; and [7]')
    const html = renderTurn({ n: 1, question: '<i>q</i>', retrieval, answer: { text: 'ok [1]' }, changes: ['hops=1'], unknown: ['bogus'] })
    expect(html).toContain('&lt;i&gt;q&lt;/i&gt;')
    expect(html).toContain('Synth &lt;DIY&gt;')
    expect(html).toContain('id="src-1-1"')
    expect(html).toContain('Settings: hops=1')
    expect(html).toContain('Ignored: bogus')
    expect(renderTurn({ n: 1, question: 'q', retrieval, answer: { error: 'down' } })).toContain('role="alert"')
  })
})

describe('option text', () => {
  it('parses name=value and bare switches, and reports unknown names', () => {
    expect(parseTune('hops=1, similar --fanout=6 nope')).toEqual({ pairs: [['hops', '1'], ['similar', ''], ['fanout', '6']], unknown: ['nope'] })
    expect(changes(tune([['hops', '1'], ['similar', '']]))).toEqual(['hops=1', 'similar=true'])
    expect(changes(tune([]))).toEqual([])
  })
})

let servers = []
afterEach(async () => {
  for (const s of servers) await new Promise(resolve => s.close(resolve))
  servers = []
})
const listen = async (server) => {
  servers.push(server)
  await new Promise(resolve => server.listen(0, resolve))
  return server.address().port
}

describe('Ask routes', () => {
  async function app () {
    const seen = []
    const ollama = http.createServer((req, res) => {
      let raw = ''
      req.on('data', c => { raw += c })
      req.on('end', () => {
        seen.push(JSON.parse(raw))
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ message: { content: 'Build from kits [1].' } }))
      })
    })
    const ollamaPort = await listen(ollama)
    const facets = [notes, createAskFacet({ providers: [{ ...local, baseUrl: `http://localhost:${ollamaPort}` }] })]
    const port = await listen(createServer({ facets, defaultFacet: 'notes', services: { auth: new Auth({ token: TOKEN }) } }))
    return { base: `http://localhost:${port}`, seen }
  }

  it('is private to the owner', async () => {
    const { base } = await app()
    const page = await fetch(`${base}/ask/`, { redirect: 'manual' })
    expect(page.status).toBe(303)
    expect(page.headers.get('location')).toContain('/login')
    const anon = await fetch(`${base}/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ q: 'synth' }) })
    expect(anon.status).toBe(401)
  })

  it('answers a JSON question with the turn, and tunes by form fields', async () => {
    const { base, seen } = await app()
    const res = await fetch(`${base}/ask`, { method: 'POST', headers: JSON_AUTH, body: JSON.stringify({ q: 'modular synth', turn: 2, tune: 'hops=1 bogus', history: JSON.stringify([{ q: 'hi', a: 'hello' }]) }) })
    const out = await res.json()
    expect(out.answer).toBe('Build from kits [1].')
    expect(out.html).toContain('DIM · ollama/qwen')
    expect(out.html).toContain('id="turn-2"')
    expect(out.html).toContain('href="#src-2-1"')
    expect(out.html).toContain('Synth &lt;DIY&gt;')
    expect(out.html).toContain('Settings: hops=1')
    expect(out.html).toContain('Ignored: bogus')
    expect((await (await fetch(`${base}/ask`, { method: 'POST', headers: JSON_AUTH, body: JSON.stringify({ q: 'synth' }) })).json()).html).toContain('Settings: defaults')
    expect(seen[0].messages.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(seen[0].messages[3].content).toContain('Build a modular synth from kits.')
  })

  it('can skip the answer, and renders a page for a plain form post', async () => {
    const { base, seen } = await app()
    const only = await (await fetch(`${base}/ask`, { method: 'POST', headers: JSON_AUTH, body: JSON.stringify({ q: 'synth', contextOnly: '1' }) })).json()
    expect(only.answer).toBeNull()
    expect(only.html).toContain('Retrieval only')
    expect(seen).toHaveLength(0)
    const page = await fetch(`${base}/ask`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }, body: new URLSearchParams({ q: 'synth', similar: '1' }) })
    const html = await page.text()
    expect(page.status).toBe(200)
    expect(html).toContain('<form id="ask-form"')
    expect(html).toContain('id="turn-1"')
    expect(html).toContain('name="similar" value="1" checked')
    expect((await fetch(`${base}/ask`, { method: 'POST', headers: JSON_AUTH, body: JSON.stringify({ q: '  ' }) })).status).toBe(400)
  })
})
