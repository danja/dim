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
 * → { text } or { error } (model unreachable, missing, slow).
 * remote: { baseUrl, apiKey, model } for an OpenAI-compatible API (opt-in:
 * the sources leave the machine); otherwise Ollama at baseUrl.
 */
export async function answer ({ baseUrl, model = ASK_CONFIG.model, remote = null, question, retrieval, history = [], fetchFn = fetch }) {
  if (!baseUrl && !remote) return { error: 'No model is configured: set OLLAMA_URL (or the ASK_LLM_* variables).' }
  const messages = [{ role: 'system', content: SYSTEM }, ...historyMessages(history), { role: 'user', content: userMessage(question, retrieval) }]
  const target = remote
    ? { url: `${remote.baseUrl.replace(/\/$/, '')}/chat/completions`, headers: { Authorization: `Bearer ${remote.apiKey}` }, body: { model: remote.model, messages, max_tokens: ASK_CONFIG.maxTokens }, name: remote.model }
    : { url: `${baseUrl.replace(/\/$/, '')}/api/chat`, headers: {}, body: { model, messages, stream: false, options: { num_predict: ASK_CONFIG.maxTokens } }, name: model }
  let response
  try {
    response = await fetchFn(target.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...target.headers },
      body: JSON.stringify(target.body),
      signal: AbortSignal.timeout(ASK_CONFIG.timeoutMs)
    })
  } catch (error) {
    return { error: `Could not reach the model: ${error.message}` }
  }
  if (!response.ok) return { error: `The model answered HTTP ${response.status}${response.status === 404 ? ` (is ${target.name} available?)` : ''}` }
  const data = await response.json()
  const text = String(data.message?.content ?? data.choices?.[0]?.message?.content ?? '').trim()
  return text ? { text } : { error: 'The model gave an empty answer.' }
}

export default answer
