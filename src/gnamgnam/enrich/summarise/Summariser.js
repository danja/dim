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
