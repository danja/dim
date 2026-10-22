import { registerRoutes } from './api/routes.js'
import { ASK_CONFIG } from '../../config/preferences.js'

/**
 * Ask — a chat over graph retrieval (src/common/rag): each question finds
 * what DIM holds, then a local Ollama model answers from it with citations.
 * No data of its own and no public hooks; the owner only. ollamaUrl null
 * means retrieval only unless remote ({ baseUrl, apiKey, model }, an
 * OpenAI-compatible API) is set; that is opt-in because the sources leave the
 * machine.
 */

export function createAskFacet ({ ollamaUrl = null, model = ASK_CONFIG.model, remote = null } = {}) {
  return {
    id: 'ask',
    label: 'Ask',
    description: 'Ask questions answered from everything in DIM, by graph retrieval.',

    routes (router, ctx) {
      registerRoutes(router, { ...ctx, ollamaUrl, model, remote })
    },

    async health () {
      return { status: 'ok', model: remote?.model ?? (ollamaUrl ? model : null) }
    }
  }
}

export default createAskFacet
