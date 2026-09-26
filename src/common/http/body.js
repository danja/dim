/**
 * Request bodies for write routes: HTML form posts
 * (application/x-www-form-urlencoded) and JSON. Size-capped; anything else
 * is refused rather than guessed at.
 */

export class BodyError extends Error {
  constructor (message, status = 400) {
    super(message)
    this.name = 'BodyError'
    this.status = status
  }
}

export const MAX_BODY_BYTES = 256 * 1024

async function readRaw (request, maxBytes) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBytes) throw new BodyError(`Body larger than ${maxBytes} bytes`, 413)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** → a plain object. Repeated form keys become arrays. */
export async function readBody (request, { maxBytes = MAX_BODY_BYTES } = {}) {
  const type = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  const raw = await readRaw(request, maxBytes)
  if (raw === '') return {}
  if (type === 'application/json') {
    let body
    try {
      body = JSON.parse(raw)
    } catch (error) {
      throw new BodyError(`Invalid JSON: ${error.message}`)
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BodyError('JSON body must be an object')
    return body
  }
  if (type === 'application/x-www-form-urlencoded') {
    const out = {}
    for (const [key, value] of new URLSearchParams(raw)) {
      if (key in out) out[key] = [].concat(out[key], value)
      else out[key] = value
    }
    return out
  }
  throw new BodyError(`Unsupported content type ${JSON.stringify(type || '(none)')}; send a form or JSON`, 415)
}

/** True when the client wants JSON back rather than a redirect to a page. */
export function wantsJson (request) {
  const type = String(request.headers['content-type'] ?? '')
  const accept = String(request.headers.accept ?? '')
  return type.startsWith('application/json') || (accept.includes('application/json') && !accept.includes('text/html'))
}
