import { ENRICH_CONFIG } from '../../../../config/preferences.js'
import { Summariser, SummariseError } from './Summariser.js'
import { buildPrompt, resultFromReply, CircuitBreaker } from './llm.js'

/**
 * Remote LLM through any OpenAI-compatible chat-completions API — OpenCode
 * Zen, OpenRouter, Groq, a llama.cpp server, … — configured by:
 *
 *   LLM_BASE_URL  e.g. https://…/v1   (POST {base}/chat/completions)
 *   LLM_API_KEY   sent as a Bearer token
 *   LLM_MODEL     the provider's model id
 *   LLM_MAX_TOKENS optional reply budget (default ENRICH_CONFIG.llmMaxTokens);
 *                 raise it for "thinking" models, whose reasoning counts
 *                 against it — e.g. Gemini Flash
 *
 * Gemini: LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
 *
 * Page text leaves the machine: only public pages are fetched, but which
 * pages you bookmarked is itself information. Check the provider's terms
 * (free tiers often keep or train on prompts).
 *
 * Polite by default: one request per remoteRequestIntervalMs; a 429 waits
 * for Retry-After (capped at 60s) and retries once; 401/403 stops at once
 * since every later call would fail the same way. Like the Ollama
 * summariser it returns null on failure so the offline chain takes over.
 */

const RETRY_AFTER_CAP_MS = 60000

function hostOf (url) {
  try { return new URL(url).host } catch { return 'remote' }
}

function retryAfterMs (response) {
  const seconds = Number(response.headers.get('retry-after'))
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, RETRY_AFTER_CAP_MS) : 10000
}

export class RemoteSummariser extends Summariser {
  constructor ({
    baseUrl,
    apiKey,
    model,
    promptVersion = ENRICH_CONFIG.promptVersion,
    maxChars = ENRICH_CONFIG.summaryMaxChars,
    keywordMax = ENRICH_CONFIG.keywordMax,
    inputChars = ENRICH_CONFIG.llmInputChars,
    maxTokens = ENRICH_CONFIG.llmMaxTokens,
    timeoutMs = ENRICH_CONFIG.remoteTimeoutMs,
    requestIntervalMs = ENRICH_CONFIG.remoteRequestIntervalMs,
    failureLimit = ENRICH_CONFIG.llmFailureLimit,
    fetchImpl = fetch,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  } = {}) {
    super()
    for (const [key, value] of Object.entries({ LLM_BASE_URL: baseUrl, LLM_API_KEY: apiKey, LLM_MODEL: model })) {
      if (!value) throw new SummariseError(`The remote summariser needs ${key} (see .env.example)`)
    }
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.apiKey = apiKey
    this.model = model
    this.promptVersion = promptVersion
    this.maxChars = maxChars
    this.keywordMax = keywordMax
    this.inputChars = inputChars
    this.maxTokens = maxTokens
    this.timeoutMs = timeoutMs
    this.requestIntervalMs = requestIntervalMs
    this.fetchImpl = fetchImpl
    this.sleep = sleep
    this.lastRequestAt = 0
    this.breaker = new CircuitBreaker({ name: `remote LLM ${hostOf(baseUrl)}`, limit: failureLimit })
  }

  static fromEnv (env = process.env, options = {}) {
    const maxTokens = env.LLM_MAX_TOKENS ? Number(env.LLM_MAX_TOKENS) : undefined
    if (maxTokens !== undefined && !(Number.isInteger(maxTokens) && maxTokens > 0)) {
      throw new SummariseError(`LLM_MAX_TOKENS must be a positive integer, got ${JSON.stringify(env.LLM_MAX_TOKENS)}`)
    }
    return new RemoteSummariser({ baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL, maxTokens, ...options })
  }

  get id () { return `remote/${hostOf(this.baseUrl)}/${this.model}-${this.promptVersion}` }

  async #pace () {
    const wait = this.requestIntervalMs - (Date.now() - this.lastRequestAt)
    if (wait > 0) await this.sleep(wait)
    this.lastRequestAt = Date.now()
  }

  async #post (prompt) {
    await this.#pace()
    return this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: this.maxTokens,
        temperature: 0.2,
        stream: false
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    })
  }

  async summarise (text, ctx = {}) {
    if (!text || !text.trim() || this.breaker.open) return null
    const prompt = buildPrompt(text, this.inputChars)
    let response
    try {
      response = await this.#post(prompt)
      if (response.status === 429) {
        await this.sleep(retryAfterMs(response))
        response = await this.#post(prompt)
      }
    } catch (error) {
      this.breaker.failure(`request failed: ${error.message}`)
      return null
    }
    if (response.status === 401 || response.status === 403) {
      this.breaker.failures = this.breaker.limit - 1
      this.breaker.failure(`HTTP ${response.status} — check LLM_API_KEY and that ${this.model} is available to it`)
      return null
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200)
      this.breaker.failure(`HTTP ${response.status} ${detail}`)
      return null
    }
    let choice
    try {
      choice = (await response.json())?.choices?.[0] ?? null
    } catch (error) {
      this.breaker.failure(`unreadable reply: ${error.message}`)
      return null
    }
    const result = resultFromReply(choice?.message?.content ?? null, { text, ctx, maxChars: this.maxChars, keywordMax: this.keywordMax, id: this.id })
    if (result) this.breaker.success()
    else if (choice?.finish_reason === 'length') this.breaker.failure(`reply cut off at ${this.maxTokens} tokens — a thinking model? raise LLM_MAX_TOKENS`)
    else this.breaker.failure('empty reply')
    return result
  }
}

export default RemoteSummariser
