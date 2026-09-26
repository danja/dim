/**
 * Shared outbound-fetch helpers (lifted from the GnamGnam enricher): a byte
 * cap that stops reading at the limit, charset-aware decoding, and status
 * and content-type tidying.
 */

/** A recordable HTTP status: any three-digit code, standard or not. */
export function statusCode (value) {
  const n = Number(value)
  return value !== null && value !== undefined && value !== '' && Number.isInteger(n) && n >= 100 && n <= 999 ? n : null
}

export function cleanContentType (headers) {
  const raw = headers.get?.('content-type') ?? headers['content-type'] ?? null
  return raw?.split(';')[0]?.trim() || null
}

/** → { bytes: Buffer, truncated } — reads at most maxBytes, then cancels. */
export async function readBytes (response, maxBytes) {
  if (!response.body?.getReader) {
    const all = Buffer.from(await response.arrayBuffer())
    return { bytes: all.subarray(0, maxBytes), truncated: all.length > maxBytes }
  }
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
    if (size > maxBytes) {
      truncated = true
      await reader.cancel().catch(() => {})
      break
    }
  }
  const bytes = Buffer.concat(chunks.map(c => Buffer.from(c)))
  return { bytes: bytes.subarray(0, maxBytes), truncated }
}

/** Charset from the header, else an XML declaration or <meta charset>, else UTF-8. */
export function decodeBody (bytes, contentTypeHeader = '') {
  const head = bytes.subarray(0, 1024).toString('latin1')
  const label = /charset=["']?([\w-]+)/i.exec(contentTypeHeader ?? '')?.[1] ??
    /<\?xml[^>]*encoding=["']([\w-]+)/i.exec(head)?.[1] ??
    /<meta[^>]*charset=["']?([\w-]+)/i.exec(head)?.[1] ?? 'utf-8'
  try {
    return new TextDecoder(label.toLowerCase()).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

export async function readCapped (response, maxBytes) {
  const { bytes, truncated } = await readBytes(response, maxBytes)
  return { text: decodeBody(bytes, response.headers?.get?.('content-type')), truncated }
}
