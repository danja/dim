import { PROVIDERS } from '../gnamgnam/enrich/summarise/providers.js'

/**
 * Optional: ask an LLM to talk through the top suggestions. Advisory only —
 * it never changes the order. Uses the enrichment settings: the first
 * provider in LLM_PROVIDERS with a key, else LLM_BASE_URL/LLM_API_KEY/LLM_MODEL.
 * Task titles and reasons leave the machine; nothing else does.
 */

export function llmConfig (env = process.env) {
  for (const name of String(env.LLM_PROVIDERS ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
    const p = PROVIDERS[name]
    const key = p && env[p.keyVar]
    if (key) return { name, baseUrl: env[`${name.toUpperCase()}_BASE_URL`] || p.baseUrl, apiKey: key, model: env[`${name.toUpperCase()}_MODEL`] || p.model, maxTokens: p.maxTokens }
  }
  if (env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_MODEL) return { name: 'llm', baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL, maxTokens: Number(env.LLM_MAX_TOKENS) || 1024 }
  return null
}

export function explainPrompt (ranked, { minutes, context }) {
  const lines = ranked.map((r, i) => `${i + 1}. ${r.task.title} — score ${r.score}; ${r.reasons.map(x => x.text).join('; ') || 'no particular reason'}`)
  return `I am choosing what to work on next${minutes ? ` with about ${minutes} minutes` : ''}${context ? ` in context ${context}` : ''}. My task manager ranked these:

${lines.join('\n')}

In two or three plain sentences, say which one I should start with and why, and whether any other stands out. Refer only to the tasks listed.`
}

export async function explain (ranked, { minutes = null, context = null, config = llmConfig(), fetchImpl = fetch, timeoutMs = 30000 } = {}) {
  if (!config) return { ok: false, error: 'No LLM configured (see LLM_PROVIDERS in .env.example)' }
  if (!ranked.length) return { ok: false, error: 'Nothing to explain' }
  try {
    const response = await fetchImpl(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: explainPrompt(ranked, { minutes, context }) }], max_tokens: config.maxTokens, temperature: 0.3 }),
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!response.ok) return { ok: false, error: `${config.name} answered HTTP ${response.status}` }
    const text = (await response.json())?.choices?.[0]?.message?.content?.trim()
    return text ? { ok: true, text: text.slice(0, 2000), by: `${config.name}/${config.model}` } : { ok: false, error: 'Empty reply' }
  } catch (error) {
    return { ok: false, error: `${config.name}: ${error.message}` }
  }
}
