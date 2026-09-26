import { HARVEST_CONFIG } from '../../../../config/preferences.js'
import { Fetcher, FetchError, REFUSALS, fetchJson } from './Fetcher.js'

/** Site-specific fetchers that use a public API instead of scraping HTML. */

/**
 * github.com/<owner>/<repo> → repo metadata + topics as plain text.
 * Unauthenticated, the GitHub API allows 60 requests an hour; set
 * GITHUB_TOKEN (any read-only token) for 5000.
 */
export class GithubApiFetcher extends Fetcher {
  constructor ({ userAgent = HARVEST_CONFIG.userAgent, timeoutMs = 15000, token = process.env.GITHUB_TOKEN || null } = {}) {
    super()
    this.userAgent = userAgent
    this.timeoutMs = timeoutMs
    this.token = token
  }

  canHandle ({ url }) {
    return /^https?:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(url)
  }

  async fetch (url) {
    const api = url.replace(/\/$/, '').replace('https://github.com/', 'https://api.github.com/repos/')
    const headers = { Accept: 'application/vnd.github+json' }
    if (this.token) headers.Authorization = `Bearer ${this.token}`
    let result
    try {
      result = await fetchJson(api, { userAgent: this.userAgent, timeoutMs: this.timeoutMs, headers })
    } catch (error) {
      throw new FetchError(`GitHub API failed: ${error.message}`, { url, cause: error })
    }
    if (!result.ok) return { url, body: null, contentType: null, httpStatus: result.status, refused: REFUSALS.has(result.status) }
    const j = result.json
    const lines = [
      `${j.full_name ?? ''} — ${j.description ?? 'no description'}`,
      j.language ? `Language: ${j.language}` : null,
      j.stargazers_count != null ? `Stars: ${j.stargazers_count}` : null,
      (j.topics?.length) ? `Topics: ${j.topics.join(', ')}` : null,
      j.homepage ? `Homepage: ${j.homepage}` : null
    ].filter(Boolean)
    return {
      url,
      body: lines.join('\n'),
      contentType: 'text/plain',
      httpStatus: 200,
      refused: false,
      title: j.full_name ?? null,
      description: j.description ?? null,
      catalogue: {
        githubLanguage: j.language ?? null,
        githubStars: j.stargazers_count ?? null,
        githubTopic: j.topics ?? []
      }
    }
  }
}

/** arxiv.org/abs/<id> → title + abstract via the arXiv API. */
export class ArxivFetcher extends Fetcher {
  constructor ({ userAgent = HARVEST_CONFIG.userAgent, timeoutMs = 15000 } = {}) {
    super()
    this.userAgent = userAgent
    this.timeoutMs = timeoutMs
  }

  canHandle ({ url }) {
    return /arxiv\.org\//.test(url)
  }

  async fetch (url) {
    const id = (url.match(/arxiv\.org\/(?:abs|pdf)\/([0-9a-z+./-]+)/i)?.[1] ?? '').replace(/\.pdf$/i, '').replace(/v\d+$/, '')
    if (!id) return { url, body: null, contentType: null, httpStatus: null, refused: false }
    let response
    try {
      response = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(this.timeoutMs)
      })
    } catch (error) {
      throw new FetchError(`arXiv API failed: ${error.message}`, { url, cause: error })
    }
    if (!response.ok) return { url, body: null, contentType: null, httpStatus: response.status, refused: REFUSALS.has(response.status) }
    const xml = await response.text()
    const title = xml.match(/<title>([\s\S]*?)<\/title>\s*<id>/)?.[1]?.replace(/\s+/g, ' ').trim() ?? null
    const summary = xml.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, ' ').trim() ?? null
    const authors = [...xml.matchAll(/<author>\s*<name>([^<]+)<\/name>/g)].map(m => m[1].trim())
    const categories = [...xml.matchAll(/<category[^>]*\bterm="([^"]+)"/g)].map(m => m[1].trim())
    if (!title && !summary) return { url, body: null, contentType: null, httpStatus: response.status, refused: false }
    const body = [`${title ?? 'arXiv paper'}${authors.length ? ` — ${authors.join(', ')}` : ''}`, summary].filter(Boolean).join('\n\n')
    return {
      url,
      body,
      contentType: 'text/plain',
      httpStatus: 200,
      refused: false,
      title,
      description: summary,
      catalogue: { arxivAuthor: authors, arxivCategory: categories }
    }
  }
}

/** *.wikipedia.org/wiki/<title> → REST summary extract as plain text. */
export class WikipediaFetcher extends Fetcher {
  constructor ({ userAgent = HARVEST_CONFIG.userAgent, timeoutMs = 15000 } = {}) {
    super()
    this.userAgent = userAgent
    this.timeoutMs = timeoutMs
  }

  canHandle ({ url }) {
    return /\.wikipedia\.org\/wiki\//.test(url)
  }

  async fetch (url) {
    const m = url.match(/https?:\/\/([a-z-]+)\.wikipedia\.org\/wiki\/([^#?]+)/)
    if (!m) return { url, body: null, contentType: null, httpStatus: null, refused: false }
    const api = `https://${m[1]}.wikipedia.org/api/rest_v1/page/summary/${m[2]}`
    let result
    try {
      result = await fetchJson(api, { userAgent: this.userAgent, timeoutMs: this.timeoutMs })
    } catch (error) {
      throw new FetchError(`Wikipedia API failed: ${error.message}`, { url, cause: error })
    }
    if (!result.ok) return { url, body: null, contentType: null, httpStatus: result.status, refused: REFUSALS.has(result.status) }
    const body = [result.json.title, result.json.extract].filter(Boolean).join('\n\n') || null
    return {
      url,
      body,
      contentType: body ? 'text/plain' : null,
      httpStatus: 200,
      refused: false,
      title: result.json.title ?? null,
      description: result.json.extract ?? null
    }
  }
}
