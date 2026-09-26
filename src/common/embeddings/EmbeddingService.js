import { createHash } from 'crypto'
import logger from 'loglevel'
import { EMBEDDING_CONFIG } from '../../../config/preferences.js'
import VectorOperations from '../vectors/VectorOperations.js'

/**
 * Embedding generation for bookmarks. Adapted from plugin-universe
 * EmbeddingService: the composed text view is link text + URL host + fetched
 * title/description + SKOS type labels + tags, rather than plugin fields.
 */

export class EmbeddingError extends Error {
  constructor (message, { cause = null } = {}) {
    super(message)
    this.name = 'EmbeddingError'
    if (cause) this.cause = cause
  }
}

function localName (term) {
  if (typeof term !== 'string') {
    throw new EmbeddingError(`Expected an IRI or a label, got ${typeof term}`)
  }
  const cut = Math.max(term.lastIndexOf('/'), term.lastIndexOf('#'))
  return cut === -1 ? term : term.slice(cut + 1)
}

export function textView (bookmark) {
  if (!bookmark || !bookmark.url) {
    throw new EmbeddingError('Cannot compose text for a bookmark with no URL')
  }
  let host = null
  try { host = new URL(bookmark.url).hostname } catch { host = null }
  return {
    linkText: bookmark.linkText ?? null,
    url: bookmark.url,
    host,
    title: bookmark.title ?? null,
    description: bookmark.description ?? null,
    summary: bookmark.summary ?? null,
    keywords: bookmark.keywords ?? [],
    bookmarkTypes: (bookmark.bookmarkTypes ?? []).map(localName),
    tags: bookmark.tags ?? []
  }
}

export function composeText (bookmark) {
  const view = textView(bookmark)
  const parts = []
  if (view.linkText) parts.push(view.linkText)
  if (view.title && view.title !== view.linkText) parts.push(view.title)
  if (view.host) parts.push(`on ${view.host}`)
  if (view.bookmarkTypes.length) parts.push(view.bookmarkTypes.join(', '))
  if (view.description) parts.push(view.description)
  if (view.summary && view.summary !== view.description) parts.push(view.summary)
  if (view.keywords.length) parts.push(view.keywords.join(', '))
  if (view.tags.length) parts.push(view.tags.join(', '))
  parts.push(view.url)
  return parts.join('. ')
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

  async embedBookmark (bookmark) {
    const text = composeText(bookmark)
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

  async embedBatch (bookmarks) {
    const results = []
    for (const bookmark of bookmarks) {
      results.push(await this.embedBookmark(bookmark))
    }
    return results
  }

  async isAvailable () {
    return this.provider.isAvailable()
  }
}

export default EmbeddingService
