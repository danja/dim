import http from 'http'
import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from '../../src/server.js'
import Auth from '../../src/common/http/auth.js'
import { createAskFacet } from '../../src/ask/index.js'
import { answer, userMessage, historyMessages } from '../../src/ask/answer.js'
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

describe('answer', () => {
  it('sends sources, earlier turns and the question to Ollama chat', async () => {
    let sent
    const fetchFn = async (url, init) => {
      sent = { url, body: JSON.parse(init.body) }
      return { ok: true, json: async () => ({ message: { content: ' Use kits [1]. ' } }) }
    }
    const out = await answer({ baseUrl: 'http://ollama:11434/', question: 'How?', retrieval, history: [{ q: 'before', a: 'earlier' }], fetchFn })
    expect(out).toEqual({ text: 'Use kits [1].' })
    expect(sent.url).toBe('http://ollama:11434/api/chat')
    expect(sent.body.stream).toBe(false)
    expect(sent.body.messages.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(sent.body.messages[3].content).toContain('[1] Synth <DIY> (Notes)')
    expect(sent.body.messages[3].content).toContain('Question: How?')
  })

  it('can use an OpenAI-compatible API when one is configured', async () => {
    let sent
    const fetchFn = async (url, init) => {
      sent = { url, headers: init.headers, body: JSON.parse(init.body) }
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'Remote [1]' } }] }) }
    }
    const remote = { baseUrl: 'https://api.example.com/v1/', apiKey: 'k', model: 'big' }
    expect(await answer({ remote, question: 'How?', retrieval, fetchFn })).toEqual({ text: 'Remote [1]' })
    expect(sent.url).toBe('https://api.example.com/v1/chat/completions')
    expect(sent.headers.Authorization).toBe('Bearer k')
    expect(sent.body.model).toBe('big')
  })

  it('reports problems instead of throwing', async () => {
    expect((await answer({ baseUrl: null, question: 'x', retrieval })).error).toMatch(/OLLAMA_URL/)
    expect((await answer({ baseUrl: 'http://x', question: 'x', retrieval, fetchFn: async () => { throw new Error('refused') } })).error).toMatch(/refused/)
    expect((await answer({ baseUrl: 'http://x', question: 'x', retrieval, fetchFn: async () => ({ ok: false, status: 404 }) })).error).toMatch(/available/)
    expect((await answer({ baseUrl: 'http://x', question: 'x', retrieval, fetchFn: async () => ({ ok: true, json: async () => ({ message: { content: '' } }) }) })).error).toMatch(/empty/)
  })

  it('says when nothing was found, and trims and ignores bad history', () => {
    expect(userMessage('q', { items: [] })).toContain('No sources were found.')
    expect(historyMessages('nope')).toEqual([])
    expect(historyMessages([1, 2, 3, 4, 5, 6].map(i => ({ q: `q${i}`, a: `a${i}` }))).length).toBe(8)
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
    const facets = [notes, createAskFacet({ ollamaUrl: `http://localhost:${ollamaPort}` })]
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
