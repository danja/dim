import logger from 'loglevel'
import { ENRICH_CONFIG } from '../../../config/preferences.js'
import { tokenise } from '../../common/search/LexicalIndex.js'

/**
 * Pluggable summarisers for the second-pass enricher (docs/enricher.md).
 *
 * A summariser turns extracted text into a rich payload:
 *
 *   { summary, keywords, markdown, model }
 *
 * - summary: ≤1000-char derived abstract (stored as dim:summary).
 * - keywords: ≤12 lower-cased key terms (stored as repeated dim:keyword).
 * - markdown: short structured document (stored as dim:summaryMarkdown).
 *
 * Summarisers are tried in registry order — Ollama first when available,
 * mechanical (frequency keywords + lead sentences, no network) next,
 * extractive as the final safety net. The summariser id is recorded as
 * dim:summaryModel for provenance. Markdown is composed locally by
 * buildMarkdown() in every path, so its shape never depends on the LLM.
 */

export class SummariseError extends Error {
  constructor (message, { summariser = null, cause = null } = {}) {
    super(message)
    this.name = 'SummariseError'
    this.summariser = summariser
    if (cause) this.cause = cause
  }
}

export class Summariser {
  get id () { return 'unknown' }
  async summarise (_text, _ctx) { throw new SummariseError(`${this.constructor.name} does not implement summarise()`) }
}

export function splitSentences (text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .match(/[^.!?]+[.!?]+["']?/g)?.map(s => s.trim()).filter(Boolean) ?? []
}

const STOPWORDS = new Set(String(
  'a an the and or but if then else when at by for with about into through during ' +
  'before after above below to from up down in out on off over under again further ' +
  'once here there all any both each few more most other some such no nor not only ' +
  'own same so than too very can will just should now is are was were be been being ' +
  'have has had having do does did doing would could ought of as it its this that ' +
  'these those he she they them his her their you your we our us i me my what which ' +
  'who whom how why where because while also per via within without between across ' +
  'among et al may many much every shall must might need used using use often still'
).split(' '))

/**
 * Frequency key terms over lexical-index tokens: stopwords, short and
 * numeric tokens dropped, ties broken by first occurrence. Title text is
 * prepended by callers to weight it (frequency does the rest).
 */
export function extractKeywords (text, { max = 12 } = {}) {
  const counts = new Map()
  const first = new Map()
  let pos = 0
  for (const token of tokenise(text)) {
    pos += 1
    if (token.length < 3 || STOPWORDS.has(token) || /^[0-9]+$/.test(token)) continue
    counts.set(token, (counts.get(token) ?? 0) + 1)
    if (!first.has(token)) first.set(token, pos)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || first.get(a[0]) - first.get(b[0]))
    .slice(0, max)
    .map(([term]) => term)
}

export function normaliseKeywords (terms, { max = 12 } = {}) {
  const out = []
  for (const raw of terms ?? []) {
    const term = String(raw ?? '').trim().toLowerCase()
    if (term.length < 2 || out.includes(term)) continue
    out.push(term)
    if (out.length >= max) break
  }
  return out
}

/** Deterministic markdown document for a bookmark summary. */
export function buildMarkdown ({ title, url, summary, keywords = [], types = [], markdownMaxChars = ENRICH_CONFIG.markdownMaxChars } = {}) {
  if (!summary && !title && !url) return null
  let domain = null
  try { domain = new URL(url).hostname } catch { domain = null }
  const lines = [`# ${title || url || 'Untitled'}`, '']
  if (summary) lines.push(summary, '')
  const meta = []
  if (domain) meta.push(`- Source: [${domain}](${url})`)
  else if (url) meta.push(`- Source: ${url}`)
  if (types.length) meta.push(`- Types: ${types.join(', ')}`)
  if (keywords.length) meta.push(`- Key terms: ${keywords.join(', ')}`)
  if (meta.length) lines.push(...meta)
  return lines.join('\n').trim().slice(0, markdownMaxChars) || null
}

/** Offline fallback: first sentences up to the char budget. No network. */
export class ExtractiveSummariser extends Summariser {
  constructor ({ maxChars = ENRICH_CONFIG.summaryMaxChars } = {}) {
    super()
    this.maxChars = maxChars
  }

  get id () { return 'extractive-v1' }

  async summarise (text) {
    if (!text || !text.trim()) return null
    const sentences = splitSentences(text)
    if (sentences.length === 0) {
      const clipped = text.trim().slice(0, this.maxChars)
      return clipped ? { summary: clipped, model: this.id } : null
    }
    const parts = []
    for (const s of sentences) {
      const next = parts.length ? `${parts.join(' ')} ${s}` : s
      if (next.length > this.maxChars) break
      parts.push(s)
      if (parts.length >= 3) break
    }
    const summary = (parts.join(' ').trim() || sentences[0].slice(0, this.maxChars)).trim()
    return summary ? { summary, model: this.id } : null
  }
}

/**
 * Fully mechanical summariser: lead sentences + frequency keywords +
 * composed markdown. No network ever — the guaranteed offline path.
 */
export class MechanicalSummariser extends Summariser {
  constructor ({ maxChars = ENRICH_CONFIG.summaryMaxChars, keywordMax = ENRICH_CONFIG.keywordMax } = {}) {
    super()
    this.extractive = new ExtractiveSummariser({ maxChars })
    this.keywordMax = keywordMax
  }

  get id () { return 'mechanical-v1' }

  async summarise (text, ctx = {}) {
    if (!text || !text.trim()) return null
    const lead = await this.extractive.summarise(text)
    if (!lead?.summary) return null
    const keywords = extractKeywords(`${ctx.title ?? ''}\n${text}`, { max: this.keywordMax })
    const markdown = buildMarkdown({
      title: ctx.linkText || ctx.title || null,
      url: ctx.url ?? null,
      summary: lead.summary,
      keywords,
      types: (ctx.bookmarkType ?? []).map(t => String(t).replace(/^.*\//, ''))
    })
    return { summary: lead.summary, keywords, markdown, model: this.id }
  }
}

const SUMMARY_PROMPT = `Read the following web page content. Reply in exactly this format on two lines:
SUMMARY: <2-3 plain sentences saying what it is and why it might be useful, at most 1000 characters, no marketing language>
KEY TERMS: <up to 12 comma-separated single-word key terms, lowercase>

Content:
`

/**
 * Local LLM via Ollama /api/generate. Best-effort: null on any failure so
 * the orchestrator falls through to the mechanical summariser. Keywords
 * the LLM omits are filled in mechanically; markdown is always composed
 * locally for a uniform shape.
 */
export class OllamaSummariser extends Summariser {
  constructor ({ baseUrl, model = ENRICH_CONFIG.model, promptVersion = ENRICH_CONFIG.promptVersion, maxChars = ENRICH_CONFIG.summaryMaxChars, keywordMax = ENRICH_CONFIG.keywordMax, timeoutMs = 120000 } = {}) {
    super()
    if (!baseUrl) throw new SummariseError('OllamaSummariser needs a baseUrl')
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.model = model
    this.promptVersion = promptVersion
    this.maxChars = maxChars
    this.keywordMax = keywordMax
    this.timeoutMs = timeoutMs
  }

  get id () { return `ollama/${this.model}-${this.promptVersion}` }

  async isAvailable () {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) })
      if (!response.ok) return false
      const { models } = await response.json()
      return Array.isArray(models) && models.some(m => m.name === this.model || m.model === this.model)
    } catch {
      return false
    }
  }

  async summarise (text, ctx = {}) {
    if (!text || !text.trim()) return null
    let response
    try {
      response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: `${SUMMARY_PROMPT}${text.slice(0, 6000)}`,
          stream: false,
          options: { num_predict: 300 }
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      })
    } catch (error) {
      logger.warn(`[enrich] ollama request failed: ${error.message}`)
      return null
    }
    if (!response.ok) {
      logger.warn(`[enrich] ollama HTTP ${response.status}`)
      return null
    }
    const parsed = parseStructuredReply(String((await response.json()).response ?? ''))
    const summary = (parsed.summary || '').trim().slice(0, this.maxChars) || null
    if (!summary) return null
    let keywords = normaliseKeywords(parsed.keywords, { max: this.keywordMax })
    if (!keywords.length) keywords = extractKeywords(`${ctx.title ?? ''}\n${text}`, { max: this.keywordMax })
    const markdown = buildMarkdown({
      title: ctx.linkText || ctx.title || null,
      url: ctx.url ?? null,
      summary,
      keywords,
      types: (ctx.bookmarkType ?? []).map(t => String(t).replace(/^.*\//, ''))
    })
    return { summary, keywords, markdown, model: this.id }
  }
}

/** Parse the SUMMARY:/KEY TERMS: reply shape; tolerant of extra prose. */
export function parseStructuredReply (reply) {
  const summary = reply.match(/^SUMMARY:\s*(.+?)(?=^KEY TERMS:|\s*$)/ims)?.[1]
    ?.replace(/\s+/g, ' ').trim() ?? null
  const rawTerms = reply.match(/^KEY TERMS:\s*(.+?)$/im)?.[1] ?? ''
  const keywords = rawTerms.split(/[,;\n]/).map(t => t.trim()).filter(Boolean)
  if (summary) return { summary, keywords }
  const fallback = reply.replace(/\s+/g, ' ').trim()
  return { summary: fallback || null, keywords }
}

export default Summariser
