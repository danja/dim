import fs from 'fs'
import path from 'path'
import { send } from './respond.js'

/**
 * Serve files under one directory at a URL prefix, e.g. /static/css/base.css.
 * Only known types are served; anything resolving outside root is a 404.
 */

export const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2'
})

/** Resolve a URL sub-path inside root, or null if it escapes root. */
export function resolveInside (root, subPath) {
  const base = path.resolve(root)
  const target = path.resolve(base, '.' + path.posix.normalize('/' + subPath))
  return target.startsWith(base + path.sep) ? target : null
}

export function registerStatic (router, { prefix, root, maxAge = 3600 }) {
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/(.+)$`)
  router.get(pattern, async ({ request, response, match }) => {
    let subPath
    try {
      subPath = decodeURIComponent(match[1])
    } catch {
      return send(response, 400, { error: 'Malformed path' })
    }
    const file = resolveInside(root, subPath)
    const type = file && CONTENT_TYPES[path.extname(file)]
    if (!type) return send(response, 404, { error: 'No such file' })
    let body
    try {
      body = await fs.promises.readFile(file)
    } catch {
      return send(response, 404, { error: 'No such file' })
    }
    response.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': `public, max-age=${maxAge}`
    })
    return response.end(request.method === 'HEAD' ? undefined : body)
  })
  return router
}

export default registerStatic
