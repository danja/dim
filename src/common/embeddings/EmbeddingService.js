import { createHash } from 'crypto'
import logger from 'loglevel'
import { EMBEDDING_CONFIG } from '../../../config/preferences.js'
import VectorOperations from '../vectors/VectorOperations.js'

/**
 * Embedding generation. Adapted from plugin-universe EmbeddingService.
 * Facet-agnostic: callers compose the text (e.g. gnamgnam/BookmarkText.js)
 * and pass it to embed() or embedText().
 */

export class EmbeddingError extends Error {
  constructor (message, { cause = null } = {}) {
    super(message)
    this.name = 'EmbeddingError'
    if (cause) this.cause = cause
  }
}

export function textHash (text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

export class OllamaEmbeddingProvider {
  constructor ({ baseUrl, model, dimension }) {
    for (const [key, value] of Object.entries({ baseUrl, model, dimension })) {
      if (!value) throw new EmbeddingError(`OllamaEmbeddingProvider needs ${key}`)
    }
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.model = model
    this.dimension = dimension
  }

  async embed (text) {
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
      signal: AbortSignal.timeout(EMBEDDING_CONFIG.requestTimeoutMs)
    })
    if (!response.ok) {
      const detail = await response.text()
      throw new EmbeddingError(`Ollama returned HTTP ${response.status}: ${detail}`)
    }
    const body = await response.json()
    if (!Array.isArray(body.embedding)) {
      throw new EmbeddingError('Ollama response contained no embedding array')
    }
    return body.embedding
  }

  /** Several texts in one request (Ollama /api/embed). → vectors, in order */
  async embedBatch (texts) {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts }),
      signal: AbortSignal.timeout(EMBEDDING_CONFIG.requestTimeoutMs * texts.length)
    })
    if (!response.ok) {
      const detail = await response.text()
      throw new EmbeddingError(`Ollama returned HTTP ${response.status}: ${detail}`)
    }
    const body = await response.json()
    if (!Array.isArray(body.embeddings) || body.embeddings.length !== texts.length) {
      throw new EmbeddingError('Ollama batch response did not hold one embedding per text')
    }
    return body.embeddings
  }

  async isAvailable () {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000)
      })
      if (!response.ok) return false
      const { models } = await response.json()
      return models.some(m => m.name === this.model)
    } catch {
      return false
    }
  }
}

export class EmbeddingService {
  constructor ({ provider, baseUrl, model, dimension }) {
    if (provider !== 'ollama') {
      throw new EmbeddingError(`Unsupported embedding provider "${provider}". Only "ollama" is implemented.`)
    }
    this.model = model
    this.dimension = dimension
    this.provider = new OllamaEmbeddingProvider({ baseUrl, model, dimension })
  }

  static fromConfig (config) {
    return new EmbeddingService(config.get('embedding'))
  }

  async embed (text) {
    if (typeof text !== 'string' || text.trim() === '') {
      throw new EmbeddingError('Cannot embed empty text')
    }
    let lastError = null
    for (let attempt = 1; attempt <= EMBEDDING_CONFIG.maxRetries; attempt++) {
      try {
        const vector = await this.provider.embed(text)
        VectorOperations.validate(vector, this.dimension)
        return vector
      } catch (error) {
        lastError = error
        if (error.type === 'DIMENSION_ERROR') throw error
        logger.warn(`[embedding] attempt ${attempt} failed: ${error.message}`)
        if (attempt < EMBEDDING_CONFIG.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, EMBEDDING_CONFIG.retryBackoffMs * attempt))
        }
      }
    }
    throw new EmbeddingError(
      `Embedding failed after ${EMBEDDING_CONFIG.maxRetries} attempts: ${lastError?.message}`,
      { cause: lastError }
    )
  }

  /**
   * Embed several texts at once; falls back to one at a time if the batch
   * endpoint fails (older Ollama). → vectors, in order
   */
  async embedBatch (texts) {
    if (!this.batchUnsupported) {
      try {
        const vectors = await this.provider.embedBatch(texts)
        for (const v of vectors) VectorOperations.validate(v, this.dimension)
        return vectors
      } catch (error) {
        if (error.type === 'DIMENSION_ERROR') throw error
        logger.warn(`[embedding] batch failed (${error.message}); embedding one at a time`)
        if (/HTTP 404/.test(error.message)) this.batchUnsupported = true
      }
    }
    const vectors = []
    for (const text of texts) vectors.push(await this.embed(text))
    return vectors
  }

  /** Embed composed text and return the vector with its bookkeeping. */
  async embedText (text) {
    const vector = await this.embed(text)
    return {
      vector,
      text,
      hash: textHash(text),
      model: this.model,
      dimension: this.dimension,
      embeddedAt: new Date().toISOString()
    }
  }

  async isAvailable () {
    return this.provider.isAvailable()
  }
}

export default EmbeddingService
