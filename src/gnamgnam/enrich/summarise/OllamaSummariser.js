import logger from 'loglevel'
import { ENRICH_CONFIG } from '../../../../config/preferences.js'
import { Summariser, SummariseError } from './Summariser.js'
import { extractKeywords, normaliseKeywords, buildMarkdown } from './text.js'

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
