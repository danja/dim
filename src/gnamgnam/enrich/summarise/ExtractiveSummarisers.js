import { ENRICH_CONFIG } from '../../../../config/preferences.js'
import { Summariser } from './Summariser.js'
import { splitSentences, extractKeywords, buildMarkdown } from './text.js'

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
