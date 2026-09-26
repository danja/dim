import logger from 'loglevel'
import { ENRICH_CONFIG } from '../../../../config/preferences.js'
import { Summariser, SummariseError } from './Summariser.js'
import { RemoteSummariser, retryDelayMs, parseMaxTokens } from './RemoteSummariser.js'
import { CircuitBreaker } from './llm.js'
import { PROVIDERS } from './providers.js'

/**
 * Several remote providers in preference order (after danja/peasant's
 * rotation). Each bookmark goes to the first provider that is available:
 *
 *   - 429 / 5xx / network error → that provider cools down (Retry-After, or
 *     its own backoff doubling from remoteRetryBaseMs to remoteRetryCapMs)
 *     and the next one is asked straight away;
 *   - 401 / 402 / 403 → that provider is dropped for the rest of the run;
 *   - a bad or empty reply → the next provider tries the same bookmark.
 *
 * When every remaining provider is cooling down it waits for the first to
 * come back, but never longer than rotationMaxWaitMs for one bookmark. A
 * success resets that provider's backoff. The circuit breaker counts
 * bookmarks that no provider could summarise; it opens early if every
 * provider has been dropped.
 *
 *   LLM_PROVIDERS=mistral,groq,openrouter      order of preference
 *   MISTRAL_API_KEY=… GROQ_API_KEY=…           providers without a key are skipped
 *   GROQ_MODEL=… GROQ_BASE_URL=… GROQ_MAX_TOKENS=…   optional overrides
 *
 * dim:summaryModel records the provider and model that actually answered.
 */

export class RotatingSummariser extends Summariser {
  constructor ({
    members,
    failureLimit = ENRICH_CONFIG.llmFailureLimit,
    retryBaseMs = ENRICH_CONFIG.remoteRetryBaseMs,
    retryCapMs = ENRICH_CONFIG.remoteRetryCapMs,
    maxWaitMs = ENRICH_CONFIG.rotationMaxWaitMs,
    now = () => Date.now(),
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  }) {
    super()
    if (!members?.length) throw new SummariseError('RotatingSummariser needs at least one provider')
    this.members = members.map(summariser => ({ summariser, coolUntil: 0, strikes: 0, dropped: false }))
    this.retryBaseMs = retryBaseMs
    this.retryCapMs = retryCapMs
    this.maxWaitMs = maxWaitMs
    this.now = now
    this.sleep = sleep
    this.breaker = new CircuitBreaker({ name: 'LLM rotation', limit: failureLimit })
  }

  /** Build from LLM_PROVIDERS and the providers' key variables. */
  static fromEnv (env = process.env, options = {}) {
    const names = String(env.LLM_PROVIDERS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    if (!names.length) throw new SummariseError('LLM_PROVIDERS is empty')
    const unknown = names.filter(name => !PROVIDERS[name])
    if (unknown.length) {
      throw new SummariseError(`Unknown LLM provider(s): ${unknown.join(', ')}. Known: ${Object.keys(PROVIDERS).join(', ')}`)
    }
    const globalMax = parseMaxTokens(env.LLM_MAX_TOKENS)
    const members = []
    const skipped = []
    for (const name of names) {
      const profile = PROVIDERS[name]
      const key = env[profile.keyVar]
      if (!key) {
        skipped.push(`${name} (no ${profile.keyVar})`)
        continue
      }
      const prefix = name.toUpperCase()
      members.push(new RemoteSummariser({
        name,
        baseUrl: env[`${prefix}_BASE_URL`] || profile.baseUrl,
        apiKey: key,
        model: env[`${prefix}_MODEL`] || profile.model,
        maxTokens: parseMaxTokens(env[`${prefix}_MAX_TOKENS`], `${prefix}_MAX_TOKENS`) ?? globalMax ?? profile.maxTokens,
        ...(options.memberOptions ?? {})
      }))
    }
    if (skipped.length) logger.warn(`[enrich] LLM rotation skipping ${skipped.join(', ')}`)
    if (!members.length) {
      throw new SummariseError(`None of LLM_PROVIDERS (${names.join(', ')}) has an API key set: ${skipped.join(', ')}`)
    }
    const { memberOptions: _memberOptions, ...rest } = options
    return new RotatingSummariser({ members, ...rest })
  }

  get id () {
    return `rotate(${this.members.map(m => m.summariser.name).join(',')})`
  }

  /** Human-readable state, for the run header. */
  describe () {
    return this.members.map(m => `${m.summariser.name}:${m.summariser.model}`).join(' → ')
  }

  #cooldown (member, response) {
    member.strikes += 1
    const delay = retryDelayMs(member.strikes, { response, baseMs: this.retryBaseMs, capMs: this.retryCapMs })
    member.coolUntil = this.now() + delay
    return delay
  }

  async summarise (text, ctx = {}) {
    if (!text || !text.trim() || this.breaker.open) return null
    const deadline = this.now() + this.maxWaitMs
    const failedHere = new Set()
    const reasons = []

    while (true) {
      const live = this.members.filter(m => !m.dropped && !failedHere.has(m))
      if (!live.length) break
      const ready = live.find(m => m.coolUntil <= this.now())
      if (!ready) {
        const wake = Math.min(...live.map(m => m.coolUntil))
        if (wake > deadline) {
          reasons.push(`all providers cooling down past the ${Math.round(this.maxWaitMs / 1000)}s limit`)
          break
        }
        logger.info(`[enrich] all LLM providers busy — waiting ${Math.round((wake - this.now()) / 1000)}s`)
        await this.sleep(Math.max(wake - this.now(), 0))
        continue
      }

      const name = ready.summariser.name
      const outcome = await ready.summariser.attempt(text, ctx)
      if (outcome.ok) {
        ready.strikes = 0
        this.breaker.success()
        return outcome.result
      }
      if (outcome.kind === 'transient') {
        const delay = this.#cooldown(ready, outcome.response)
        logger.info(`[enrich] ${name}: ${outcome.message} — cooling ${Math.round(delay / 1000)}s, rotating`)
      } else if (outcome.kind === 'fatal') {
        ready.dropped = true
        logger.warn(`[enrich] ${name}: ${outcome.message} — dropped for this run`)
      } else {
        failedHere.add(ready)
        reasons.push(`${name}: ${outcome.message}`)
      }
    }

    if (this.members.every(m => m.dropped)) {
      this.breaker.failures = this.breaker.limit - 1
      this.breaker.failure('every provider refused the key')
      return null
    }
    this.breaker.failure(reasons.join('; ') || 'no provider could summarise')
    return null
  }
}

export default RotatingSummariser
