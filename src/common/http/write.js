import logger from 'loglevel'
import { readBody, wantsJson } from './body.js'
import { send, sendHtml, redirect, esc } from './respond.js'
import { renderPage } from '../ui/layout.js'

/**
 * Wrap a write handler: read the body, authorise (token or session + CSRF),
 * run it, and answer a form with a 303 back to a page or a script with JSON.
 *
 * The handler receives the usual route context plus { body, identity } and
 * returns { redirect?, json?, html?, status? }. Errors carrying a .status (4xx)
 * are the client's; anything else is logged as a 500.
 */

/** Only local paths: never another origin, never protocol-relative. */
export function safeReturn (value, fallback = '/') {
  const v = typeof value === 'string' ? value : ''
  return /^\/(?!\/)[^\\\s]*$/.test(v) ? v : fallback
}

function fail (ctx, status, error, { body = {}, violations = [] } = {}) {
  const { request, response, url } = ctx
  if (wantsJson(request)) return send(response, status, { error, ...(violations.length ? { violations } : {}) })
  if (status === 401) {
    const back = safeReturn(body._return, url.pathname)
    return redirect(response, 303, `/login?return=${encodeURIComponent(back)}`)
  }
  const back = safeReturn(body._return, null)
  const items = violations.length ? `<ul>${violations.map(v => `<li>${esc(v)}</li>`).join('')}</ul>` : ''
  return sendHtml(response, status, renderPage({
    title: 'Not saved',
    tabs: ctx.tabs,
    active: null,
    session: ctx.session,
    body: `<h1>Not saved</h1>\n<p>${esc(error)}</p>${items}${back ? `\n<p><a href="${esc(back)}">← back</a></p>` : ''}`
  }))
}

export function writeRoute (handler) {
  return async (ctx) => {
    const { request, response, services } = ctx
    let body
    try {
      body = await readBody(request)
    } catch (error) {
      return fail(ctx, error.status ?? 400, error.message)
    }
    const check = services.auth.authorise(request, body)
    if (!check.ok) return fail(ctx, check.status, check.error, { body })
    try {
      const result = (await handler({ ...ctx, body, identity: check.identity })) ?? {}
      if (wantsJson(request)) return send(response, result.status ?? 200, result.json ?? { ok: true })
      // A write whose answer is a page of its own (e.g. a dice roll).
      if (result.html) return sendHtml(response, result.status ?? 200, result.html)
      return redirect(response, 303, safeReturn(body._return, result.redirect ?? '/'))
    } catch (error) {
      const status = Number.isInteger(error.status) && error.status < 500 ? error.status : 500
      if (status === 500) logger.error('[write]', error)
      return fail(ctx, status, status === 500 ? `Server error: ${error.message}` : error.message, { body, violations: error.violations ?? [] })
    }
  }
}

/** Hidden fields every form needs: the CSRF token and where to come back to. */
export function formFields (session, returnPath) {
  return `<input type="hidden" name="_csrf" value="${esc(session?.csrf ?? '')}"><input type="hidden" name="_return" value="${esc(returnPath)}">`
}
