import { CATALOG } from './catalog.js'
import { htmlText } from './htmlText.js'

/**
 * The tools an agent gets. Each one makes the request a person's browser
 * would, to this same server over loopback with the agent's own credentials,
 * so the agent sees and may do exactly what the web app allows the owner:
 * same validation, same change log, no second code path to keep in step.
 */

export const MAX_TEXT = 60000
const BLOCKED = /^\/(login|logout|mcp)(\/|$|\?)/

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}\n… (cut at ${MAX_TEXT} characters)` : t }], ...(isError ? { isError: true } : {}) })

function localPath (path) {
  if (typeof path !== 'string' || !/^\/(?!\/)[^\s\\]*$/.test(path)) throw new Error('path must be a local path starting with /, e.g. /wiki/page/home.md')
  if (BLOCKED.test(path)) throw new Error(`${path.split(/[/?]/)[1]} is not available through MCP`)
  return path
}

/** Make a request to DIM as the caller. → { status, type, body } */
async function dim (ctx, method, path, { body } = {}) {
  const res = await ctx.fetch(`${ctx.base}${path}`, {
    method,
    headers: {
      authorization: ctx.authorization,
      accept: 'application/json, text/markdown;q=0.9, text/plain;q=0.8, */*;q=0.5',
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'follow'
  })
  const type = res.headers.get('content-type') ?? ''
  const raw = await res.text()
  return { status: res.status, type, body: /html/.test(type) ? htmlText(raw) : raw }
}

const show = ({ status, body }) => text(status < 400 ? (body || '(empty)') : `HTTP ${status}\n${body}`, status >= 400)

const read = { readOnlyHint: true, openWorldHint: false }

export const TOOLS = [
  {
    name: 'dim_search',
    description: 'Search everything in DIM (bookmarks, wiki, tasks, outlines, news, blog) by words and by meaning. Returns one ranked list with links.',
    inputSchema: { type: 'object', properties: { q: { type: 'string' }, facet: { type: 'string', description: 'Limit to one facet id: gnamgnam, trestle, farelo, wiki, news, blog' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['q'] },
    annotations: read,
    run: (ctx, { q, facet, limit }) => {
      const query = new URLSearchParams({ q: String(q ?? ''), ranked: '1', ...(facet ? { facet } : {}), ...(limit ? { limit: String(limit) } : {}) })
      return dim(ctx, 'GET', `/find.json?${query}`)
    }
  },
  {
    name: 'dim_get',
    description: 'Read any page or data endpoint of DIM, as the owner would see it. Prefer the .json or .md form of a path where dim_endpoints lists one; other pages come back as text with links as "label (path)".',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'e.g. /wiki/page/home.md, /farelo/task/abc123.json, /day/2026-09-30' } }, required: ['path'] },
    annotations: read,
    run: (ctx, { path }) => dim(ctx, 'GET', localPath(path))
  },
  {
    name: 'dim_write',
    description: 'Change something in DIM: the POST endpoints behind every form (new task, edit a wiki page, annotate a bookmark, capture, link, subscribe, publish, delete…). Body fields per endpoint are in dim_endpoints. Writes are validated and change-logged like a person\'s.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'e.g. /farelo/tasks' }, body: { type: 'object', description: 'JSON fields for the endpoint' } }, required: ['path'] },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    run: (ctx, { path, body }) => dim(ctx, 'POST', localPath(path), { body: body ?? {} })
  },
  {
    name: 'dim_endpoints',
    description: 'List what DIM offers: read paths and write endpoints with their body fields. Start here to learn the paths.',
    inputSchema: { type: 'object', properties: { method: { type: 'string', enum: ['GET', 'POST'] }, filter: { type: 'string', description: 'Only paths or descriptions containing this (e.g. farelo)' } } },
    annotations: read,
    run: async (ctx, { method, filter }) => {
      const f = String(filter ?? '').toLowerCase()
      const rows = CATALOG.filter(e => (!method || e.method === method) && (!f || `${e.path} ${e.does}`.toLowerCase().includes(f)))
      return { status: 200, type: 'text/plain', body: rows.map(e => `${e.method} ${e.path} — ${e.does}${e.body ? `\n    body: ${e.body}` : ''}`).join('\n') || 'Nothing matches.' }
    }
  }
]

export const toolList = () => TOOLS.map(({ run, ...tool }) => tool)

export async function callTool (ctx, name, args) {
  const tool = TOOLS.find(t => t.name === name)
  if (!tool) return null
  try {
    return show(await tool.run(ctx, args ?? {}))
  } catch (error) {
    return text(error.message, true)
  }
}
