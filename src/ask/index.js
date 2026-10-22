import { registerRoutes } from './api/routes.js'

/**
 * Ask — a chat over graph retrieval (src/common/rag): each question finds
 * what DIM holds, then a local Ollama model answers from it with citations.
 * No data of its own and no public hooks; the owner only. providers: the models
 * to answer with, in order (src/ask/providers.js); none means retrieval only.
 */

export function createAskFacet ({ providers = [] } = {}) {
  return {
    id: 'ask',
    label: 'Ask',
    description: 'Ask questions answered from everything in DIM, by graph retrieval.',

    routes (router, ctx) {
      registerRoutes(router, { ...ctx, providers })
    },

    async health () {
      return { status: 'ok', models: providers.map(p => `${p.name}/${p.model}`) }
    }
  }
}

export default createAskFacet
