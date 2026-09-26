import logger from 'loglevel'
import { ENRICH_CONFIG } from '../../../../config/preferences.js'
import { Summariser, SummariseError } from './Summariser.js'
import { buildPrompt, resultFromReply, CircuitBreaker } from './llm.js'

/**
 * Remote LLM through any OpenAI-compatible chat-completions API — Mistral,
 * Groq, OpenRouter, Gemini's /v1beta/openai, a llama.cpp server, … One
 * provider; RotatingSummariser strings several together.
 *
 * Single-provider configuration (without LLM_PROVIDERS):
 *   LLM_BASE_URL   e.g. https://…/v1   (POST {base}/chat/completions)
 *   LLM_API_KEY    sent as a Bearer token
 *   LLM_MODEL      the provider's model id
 *   LLM_MAX_TOKENS optional reply budget (default ENRICH_CONFIG.llmMaxTokens);
 *                  raise it for "thinking" models, whose reasoning counts
 *                  against it — e.g. Gemini Flash, gpt-oss
 *
 * Page text leaves the machine: only public pages are fetched, but which
 * pages you bookmarked is itself information. Check the provider's terms
 * (free tiers often keep or train on prompts).
 *
 * Polite by default: one request per remoteRequestIntervalMs. On its own,
 * transient failures — 429, 500, 502, 503 ("high demand"), 504 and network
 * errors — are retried up to remoteMaxRetries times with exponential
 * backoff (remoteRetryBaseMs doubling, capped at remoteRetryCapMs), or after
 * the server's Retry-After. 401/402/403 stops at once since every later call
 * would fail the same way. Returns null on failure so the offline chain
 * (unless --llm-only) takes over.
 */

export const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504])
export const FATAL_STATUSES = new Set([401, 402, 403])

function hostOf (url) {
  try { return new URL(url).host } catch { return 'remote' }
}

/** Delay before retry number `attempt` (1-based): Retry-After if given, else exponential. */
export function retryDelayMs (attempt, { response = null, baseMs, capMs }) {
  const seconds = Number(response?.headers?.get?.('retry-after'))
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, capMs)
  return Math.min(baseMs * 2 ** (attempt - 1), capMs)
}

export function parseMaxTokens (value, name = 'LLM_MAX_TOKENS') {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  if (!(Number.isInteger(n) && n > 0)) throw new SummariseError(`${name} must be a positive integer, got ${JSON.stringify(value)}`)
  return n
}

export class RemoteSummariser extends Summariser {
  constructor ({
    baseUrl,
    apiKey,
    model,
    name = null,
    headers = {},
    promptVersion = ENRICH_CONFIG.promptVersion,
    maxChars = ENRICH_CONFIG.summaryMaxChars,
    keywordMax = ENRICH_CONFIG.keywordMax,
    inputChars = ENRICH_CONFIG.llmInputChars,
    maxTokens = ENRICH_CONFIG.llmMaxTokens,
    timeoutMs = ENRICH_CONFIG.remoteTimeoutMs,
    requestIntervalMs = ENRICH_CONFIG.remoteRequestIntervalMs,
    failureLimit = ENRICH_CONFIG.llmFailureLimit,
    maxRetries = ENRICH_CONFIG.remoteMaxRetries,
    retryBaseMs = ENRICH_CONFIG.remoteRetryBaseMs,
    retryCapMs = ENRICH_CONFIG.remoteRetryCapMs,
    fetchImpl = fetch,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  } = {}) {
    super()
    const label = name ? name.toUpperCase() : 'LLM'
    for (const [key, value] of Object.entries({ BASE_URL: baseUrl, API_KEY: apiKey, MODEL: model })) {
      if (!value) throw new SummariseError(`The remote summariser needs ${label}_${key} (see .env.example)`)
    }
    this.name = name ?? hostOf(baseUrl)
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.apiKey = apiKey
    this.model = model
    this.headers = headers
    this.promptVersion = promptVersion
    this.maxChars = maxChars
    this.keywordMax = keywordMax
    this.inputChars = inputChars
    this.maxTokens = maxTokens
    this.timeoutMs = timeoutMs
    this.requestIntervalMs = requestIntervalMs
    this.maxRetries = maxRetries
    this.retryBaseMs = retryBaseMs
    this.retryCapMs = retryCapMs
    this.fetchImpl = fetchImpl
    this.sleep = sleep
    this.lastRequestAt = 0
    this.breaker = new CircuitBreaker({ name: `remote LLM ${this.name}`, limit: failureLimit })
  }

  static fromEnv (env = process.env, options = {}) {
    const maxTokens = parseMaxTokens(env.LLM_MAX_TOKENS)
    return new RemoteSummariser({
      baseUrl: env.LLM_BASE_URL,
      apiKey: env.LLM_API_KEY,
      model: env.LLM_MODEL,
      ...(maxTokens ? { maxTokens } : {}),
      ...options
    })
  }

  get id () { return `remote/${hostOf(this.baseUrl)}/${this.model}-${this.promptVersion}` }

  async #pace () {
    const wait = this.requestIntervalMs - (Date.now() - this.lastRequestAt)
    if (wait > 0) await this.sleep(wait)
    this.lastRequestAt = Date.now()
  }

  /**
   * One paced request, no retries. →
   *   { ok: true, result }
   *   { ok: false, kind: 'transient', message, response }  429/5xx/network: try later or elsewhere
   *   { ok: false, kind: 'fatal', message }                401/402/403: this provider is unusable
   *   { ok: false, kind: 'failed', message }               bad request, empty or cut-off reply
   */
  async attempt (text, ctx = {}) {
    await this.#pace()
    let response
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}`, ...this.headers },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: buildPrompt(text, this.inputChars) }],
          max_tokens: this.maxTokens,
          temperature: 0.2,
          stream: false
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      })
    } catch (error) {
      return { ok: false, kind: 'transient', message: `request failed: ${error.message}`, response: null }
    }
    if (FATAL_STATUSES.has(response.status)) {
      return { ok: false, kind: 'fatal', message: `HTTP ${response.status} — check the API key and that ${this.model} is available to it` }
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)
      const kind = TRANSIENT_STATUSES.has(response.status) ? 'transient' : 'failed'
      return { ok: false, kind, message: `HTTP ${response.status} ${detail}`.trim(), response }
    }
    let choice
    try {
      choice = (await response.json())?.choices?.[0] ?? null
    } catch (error) {
      return { ok: false, kind: 'failed', message: `unreadable reply: ${error.message}` }
    }
    const result = resultFromReply(choice?.message?.content ?? null, { text, ctx, maxChars: this.maxChars, keywordMax: this.keywordMax, id: this.id })
    if (result) return { ok: true, result }
    if (choice?.finish_reason === 'length') {
      return { ok: false, kind: 'failed', message: `reply cut off at ${this.maxTokens} tokens — a thinking model? raise its max tokens` }
    }
    return { ok: false, kind: 'failed', message: 'empty reply' }
  }

  /** Single-provider use: attempt with retries on transient failures. */
  async summarise (text, ctx = {}) {
    if (!text || !text.trim() || this.breaker.open) return null
    let outcome
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = retryDelayMs(attempt, { response: outcome.response, baseMs: this.retryBaseMs, capMs: this.retryCapMs })
        logger.info(`[enrich] ${this.id}: ${outcome.message} — retry ${attempt}/${this.maxRetries} in ${Math.round(delay / 1000)}s`)
        await this.sleep(delay)
      }
      outcome = await this.attempt(text, ctx)
      if (outcome.ok || outcome.kind !== 'transient') break
    }
    if (outcome.ok) {
      this.breaker.success()
      return outcome.result
    }
    if (outcome.kind === 'fatal') {
      this.breaker.failures = this.breaker.limit - 1
      this.breaker.failure(outcome.message)
      return null
    }
    const retried = outcome.kind === 'transient' ? ` (after ${this.maxRetries} retries)` : ''
    this.breaker.failure(`${outcome.message}${retried}`)
    return null
  }
}

export default RemoteSummariser
