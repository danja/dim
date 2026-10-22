/**
 * One community's summary from its members' passages: a few sentences from
 * a local Ollama model, or null when it can't answer (the caller falls back
 * to a plain list of titles).
 */
export async function summariseCommunity (passages, { baseUrl, model, maxTokens, timeoutMs = 120000 }) {
  const body = passages.map((p, i) => `${i + 1}. ${p.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n')
  const prompt = `These items belong together in one person's notes, bookmarks and tasks. In two or three plain sentences, say what they are about and name the main subjects. No preamble.\n\n${body}`
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false, options: { num_predict: maxTokens } }),
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!response.ok) return null
    const text = String((await response.json()).response ?? '').trim()
    return text || null
  } catch {
    return null
  }
}

export default summariseCommunity
