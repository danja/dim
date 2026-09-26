import { ENRICH_CONFIG } from '../../../../config/preferences.js'
import { Summariser, SummariseError } from './Summariser.js'
import { buildPrompt, resultFromReply, CircuitBreaker } from './llm.js'

export { parseStructuredReply } from './llm.js'

/**
 * Local LLM via Ollama /api/generate. Best-effort: null on any failure so
 * the orchestrator falls through to the mechanical summariser; after
 * ENRICH_CONFIG.llmFailureLimit failures in a row it stops trying.
 */
export class OllamaSummariser extends Summariser {
  constructor ({
    baseUrl,
    model = ENRICH_CONFIG.model,
    promptVersion = ENRICH_CONFIG.promptVersion,
    maxChars = ENRICH_CONFIG.summaryMaxChars,
    keywordMax = ENRICH_CONFIG.keywordMax,
    inputChars = ENRICH_CONFIG.llmInputChars,
    maxTokens = ENRICH_CONFIG.llmMaxTokens,
    timeoutMs = ENRICH_CONFIG.ollamaTimeoutMs,
    failureLimit = ENRICH_CONFIG.llmFailureLimit
  } = {}) {
    super()
    if (!baseUrl) throw new SummariseError('OllamaSummariser needs a baseUrl')
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.model = model
    this.promptVersion = promptVersion
    this.maxChars = maxChars
    this.keywordMax = keywordMax
    this.inputChars = inputChars
    this.maxTokens = maxTokens
    this.timeoutMs = timeoutMs
    this.breaker = new CircuitBreaker({ name: 'ollama', limit: failureLimit })
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
    if (!text || !text.trim() || this.breaker.open) return null
    let response
    try {
      response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: buildPrompt(text, this.inputChars),
          stream: false,
          options: { num_predict: this.maxTokens }
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      })
    } catch (error) {
      this.breaker.failure(`request failed: ${error.message}`)
      return null
    }
    if (!response.ok) {
      this.breaker.failure(`HTTP ${response.status}${response.status === 404 ? ` (is ${this.model} pulled?)` : ''}`)
      return null
    }
    const result = resultFromReply((await response.json()).response, {
      text, ctx, maxChars: this.maxChars, keywordMax: this.keywordMax, id: this.id
    })
    if (result) this.breaker.success()
    else this.breaker.failure('empty reply')
    return result
  }
}
