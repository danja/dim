import logger from 'loglevel'
import { ASK_CONFIG } from '../../config/preferences.js'
import { PROVIDERS } from '../gnamgnam/enrich/summarise/providers.js'

/**
 * The models Ask can answer with, in preference order, after danja/peasant:
 *
 *   ASK_PROVIDERS=mistral,groq,ollama
 *
 * Names are the hosted providers DIM's bookmark summariser already knows
 * (mistral, groq, openrouter, google, huggingface, nvidia: key variable
 * <NAME>_API_KEY, optional <NAME>_BASE_URL, <NAME>_MODEL, <NAME>_MAX_TOKENS),
 * `ollama` (OLLAMA_URL, ASK_MODEL) and `custom` (any OpenAI-compatible API:
 * CUSTOM_BASE_URL, CUSTOM_API_KEY, CUSTOM_MODEL). A hosted provider with no
 * key is skipped. Unset, only Ollama is used, if OLLAMA_URL is set.
 *
 * Naming a hosted provider is what lets it see your notes: the retrieved
 * sources are sent to it. That is why the list is separate from LLM_PROVIDERS
 * (public pages being bookmarked) and nothing is tried unless named.
 *
 * → [{ name, kind: 'ollama'|'openai', baseUrl, apiKey, model, maxTokens, remote }]
 */

const keyOf = (env, name) => name === 'custom' ? env.CUSTOM_API_KEY : env[PROVIDERS[name]?.keyVar]

export function askProviders (env = process.env) {
  const named = String(env.ASK_PROVIDERS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const names = named.length ? named : (env.OLLAMA_URL ? ['ollama'] : [])
  const known = [...Object.keys(PROVIDERS), 'ollama', 'custom']
  const unknown = names.filter(n => !known.includes(n))
  if (unknown.length) throw new Error(`Unknown ASK_PROVIDERS: ${unknown.join(', ')}. Known: ${known.join(', ')}`)

  const providers = []
  const skipped = []
  for (const name of names) {
    const prefix = name.toUpperCase()
    if (name === 'ollama') {
      if (!env.OLLAMA_URL) { skipped.push('ollama (no OLLAMA_URL)'); continue }
      providers.push({ name, kind: 'ollama', baseUrl: env.OLLAMA_URL, apiKey: null, model: env.ASK_MODEL || ASK_CONFIG.model, maxTokens: ASK_CONFIG.maxTokens, remote: false, timeoutMs: ASK_CONFIG.timeoutMs })
      continue
    }
    const profile = PROVIDERS[name]
    const apiKey = keyOf(env, name)
    const baseUrl = env[`${prefix}_BASE_URL`] || profile?.baseUrl
    const model = env[`${prefix}_MODEL`] || profile?.model
    if (!apiKey) { skipped.push(`${name} (no ${name === 'custom' ? 'CUSTOM_API_KEY' : profile.keyVar})`); continue }
    if (!baseUrl || !model) throw new Error(`ASK_PROVIDERS names ${name}, which needs ${prefix}_BASE_URL and ${prefix}_MODEL`)
    const maxTokens = Number(env[`${prefix}_MAX_TOKENS`]) || Math.max(ASK_CONFIG.maxTokens, profile?.maxTokens ?? 0)
    providers.push({ name, kind: 'openai', baseUrl, apiKey, model, maxTokens, remote: true, timeoutMs: ASK_CONFIG.remoteTimeoutMs })
  }
  if (skipped.length) logger.warn(`[ask] skipping ${skipped.join(', ')}`)
  if (named.length && !providers.length) throw new Error(`None of ASK_PROVIDERS (${named.join(', ')}) is usable: ${skipped.join(', ')}`)
  return providers
}

export default askProviders
