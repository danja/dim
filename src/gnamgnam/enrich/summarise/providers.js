/**
 * Free-tier LLM providers speaking OpenAI-compatible chat completions, for
 * RotatingSummariser. Base URLs, key names and model choices follow the
 * measured profiles in danja/peasant (src/provider/profiles, docs/providers.md,
 * 2026-09-12/15). Key variables use peasant's names so one .env serves both.
 *
 * Per provider, env can override: <NAME>_BASE_URL, <NAME>_MODEL,
 * <NAME>_MAX_TOKENS. maxTokens is higher for "thinking" models, whose
 * reasoning counts against the reply budget.
 */

export const PROVIDERS = Object.freeze({
  mistral: {
    baseUrl: 'https://api.mistral.ai/v1',
    keyVar: 'MISTRAL_API_KEY',
    model: 'mistral-small-latest',
    maxTokens: 400,
    note: '125 req/min, 625k tokens/min measured'
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    keyVar: 'GROQ_API_KEY',
    model: 'openai/gpt-oss-20b',
    maxTokens: 2048,
    note: 'fast; 8k tokens/min'
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    keyVar: 'OPENROUTER_API_KEY',
    model: 'nvidia/nemotron-3-super-120b-a12b:free',
    maxTokens: 2048,
    note: ':free models; no rate-limit headers'
  },
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyVar: 'GEMINI_API_KEY',
    model: 'gemini-flash-latest',
    maxTokens: 2048,
    note: 'often 503 under load'
  },
  huggingface: {
    baseUrl: 'https://router.huggingface.co/v1',
    keyVar: 'HF_TOKEN',
    model: 'meta-llama/Llama-3.3-70B-Instruct',
    maxTokens: 400,
    note: 'router; no rate-limit headers'
  },
  nvidia: {
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    keyVar: 'NVIDIA_API_KEY',
    model: 'openai/gpt-oss-20b',
    maxTokens: 2048,
    note: 'free credits, which run out'
  }
})

export default PROVIDERS
