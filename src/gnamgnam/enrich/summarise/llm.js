import logger from 'loglevel'
import { extractKeywords, normaliseKeywords, buildMarkdown } from './text.js'

/**
 * Shared by the LLM summarisers (Ollama, remote OpenAI-compatible): one
 * prompt, one reply parser, one result shape, and a circuit breaker so a
 * dead or hopelessly slow endpoint is skipped instead of costing a
 * timeout on every bookmark.
 */

export const SUMMARY_PROMPT = `Read the following web page content. Reply in exactly this format on two lines:
SUMMARY: <2-3 plain sentences saying what it is and why it might be useful, at most 1000 characters, no marketing language>
KEY TERMS: <up to 12 comma-separated single-word key terms, lowercase>

Content:
`

export function buildPrompt (text, inputChars) {
  return `${SUMMARY_PROMPT}${text.slice(0, inputChars)}`
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

/**
 * LLM reply → the summariser payload. Keywords the model omits are filled
 * in mechanically; markdown is always composed locally for a uniform shape.
 */
export function resultFromReply (reply, { text, ctx = {}, maxChars, keywordMax, id }) {
  const parsed = parseStructuredReply(String(reply ?? ''))
  const summary = (parsed.summary || '').trim().slice(0, maxChars) || null
  if (!summary) return null
  let keywords = normaliseKeywords(parsed.keywords, { max: keywordMax })
  if (!keywords.length) keywords = extractKeywords(`${ctx.title ?? ''}\n${text}`, { max: keywordMax })
  const markdown = buildMarkdown({
    title: ctx.linkText || ctx.title || null,
    url: ctx.url ?? null,
    summary,
    keywords,
    types: (ctx.bookmarkType ?? []).map(t => String(t).replace(/^.*\//, ''))
  })
  return { summary, keywords, markdown, model: id }
}

/** Opens after `limit` consecutive failures; any success resets the count. */
export class CircuitBreaker {
  constructor ({ name, limit }) {
    this.name = name
    this.limit = limit
    this.failures = 0
  }

  get open () {
    return this.failures >= this.limit
  }

  success () {
    this.failures = 0
  }

  failure (reason) {
    this.failures += 1
    logger.warn(`[enrich] ${this.name} failed (${this.failures}/${this.limit}): ${reason}`)
    if (this.open) {
      logger.warn(`[enrich] ${this.name} failed ${this.limit} times in a row — skipping it for the rest of this run; the next summariser in the chain takes over`)
    }
  }
}
