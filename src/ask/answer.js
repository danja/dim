import { ASK_CONFIG } from '../../config/preferences.js'

/**
 * The answer step of Ask: the retrieved passages go to a local Ollama chat
 * model with the question and a few earlier turns. DIM's own retrieval
 * (src/common/rag) does the finding; the model only phrases and cites.
 */

const SYSTEM = 'You answer questions from the owner\'s own notes, bookmarks, tasks, wiki pages and posts, given as numbered sources. Use only the sources. Cite them like [1] or [2][3] after the claims they support. If the sources do not contain the answer, say so plainly and mention what they do cover. Be concise.'

/** The user message: sources, themes, then the question. */
export function userMessage (question, retrieval) {
  const sources = retrieval.items.map((item, i) => `[${i + 1}] ${item.label} (${item.facetLabel})\n${item.text}`).join('\n\n')
  const themes = retrieval.communities?.length ? `Themes in the owner's material:\n${retrieval.communities.map(c => `- ${c.summary}`).join('\n')}\n\n` : ''
  return `${sources ? `Sources:\n\n${sources}` : 'No sources were found.'}\n\n${themes}Question: ${question}`
}

/** Earlier turns, newest last, trimmed: [{ q, a }] → chat messages. */
export function historyMessages (history, { turns = ASK_CONFIG.historyTurns, chars = ASK_CONFIG.historyChars } = {}) {
  return (Array.isArray(history) ? history : []).slice(-turns).flatMap(h => [
    { role: 'user', content: String(h?.q ?? '').slice(0, ASK_CONFIG.maxQuestion) },
    { role: 'assistant', content: String(h?.a ?? '').slice(0, chars) }
  ]).filter(m => m.content)
}

/**
 * One request to one provider. →
 *   { ok: true, text }
 *   { ok: false, kind: 'transient', message, retryAfterMs }  429, 5xx, network, timeout: try later or elsewhere
 *   { ok: false, kind: 'fatal', message }                    401/402/403: unusable for now
 *   { ok: false, kind: 'failed', message }                   anything else, or an empty reply
 */
export async function ask (provider, messages, fetchFn = fetch) {
  const target = provider.kind === 'ollama'
    ? { url: `${provider.baseUrl.replace(/\/$/, '')}/api/chat`, headers: {}, body: { model: provider.model, messages, stream: false, options: { num_predict: provider.maxTokens } } }
    : { url: `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, headers: { Authorization: `Bearer ${provider.apiKey}` }, body: { model: provider.model, messages, max_tokens: provider.maxTokens, temperature: 0.2, stream: false } }
  let response
  try {
    response = await fetchFn(target.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...target.headers },
      body: JSON.stringify(target.body),
      signal: AbortSignal.timeout(provider.timeoutMs ?? ASK_CONFIG.timeoutMs)
    })
  } catch (error) {
    return { ok: false, kind: 'transient', message: error.name === 'TimeoutError' ? 'timed out' : error.message }
  }
  if (!response.ok) {
    const status = response.status
    const message = `HTTP ${status}${status === 404 ? ` (is ${provider.model} available?)` : ''}`
    if ([401, 402, 403].includes(status)) return { ok: false, kind: 'fatal', message }
    if (status === 429 || status >= 500) {
      const seconds = Number(response.headers?.get?.('retry-after'))
      return { ok: false, kind: 'transient', message, retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 300000) : undefined }
    }
    return { ok: false, kind: 'failed', message }
  }
  const data = await response.json()
  const text = String(data.message?.content ?? data.choices?.[0]?.message?.content ?? '').trim()
  return text ? { ok: true, text } : { ok: false, kind: 'failed', message: 'empty answer' }
}

/**
 * Answer with the first provider that works: one that is rate-limited or
 * failing is skipped for a while (Retry-After, else ASK_CONFIG.coolOffMs) and
 * the next is asked; one refused with 401/402/403 is dropped until restart.
 * `state` (a Map kept by the caller) carries that between questions.
 * → { text, by: 'name/model' } or { error }
 */
export async function answer ({ providers = [], state = new Map(), question, retrieval, history = [], fetchFn = fetch, now = () => Date.now() }) {
  if (!providers.length) return { error: 'No model is configured: set OLLAMA_URL, or ASK_PROVIDERS with a key (see .env.example).' }
  const messages = [{ role: 'system', content: SYSTEM }, ...historyMessages(history), { role: 'user', content: userMessage(question, retrieval) }]
  const tried = []
  const usable = () => providers.filter(p => !state.get(p.name)?.dropped)
  let candidates = usable().filter(p => (state.get(p.name)?.coolUntil ?? 0) <= now())
  // Everyone is cooling down: better to try the one that comes back first than to refuse.
  if (!candidates.length && usable().length) candidates = [usable().sort((a, b) => (state.get(a.name)?.coolUntil ?? 0) - (state.get(b.name)?.coolUntil ?? 0))[0]]
  for (const provider of candidates) {
    const result = await ask(provider, messages, fetchFn)
    if (result.ok) {
      state.delete(provider.name)
      return { text: result.text, by: `${provider.name}/${provider.model}` }
    }
    tried.push(`${provider.name}: ${result.message}`)
    if (result.kind === 'fatal') state.set(provider.name, { dropped: true })
    else state.set(provider.name, { coolUntil: now() + (result.retryAfterMs ?? ASK_CONFIG.coolOffMs) })
  }
  const dropped = providers.filter(p => state.get(p.name)?.dropped && !tried.some(t => t.startsWith(`${p.name}:`)))
  return { error: `No model could answer. ${[...tried, ...dropped.map(p => `${p.name}: refused earlier`)].join('; ') || 'All are cooling down.'}` }
}

export default answer
