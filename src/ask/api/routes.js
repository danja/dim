import { send, sendHtml, redirect } from '../../common/http/respond.js'
import { wantsJson, readBody } from '../../common/http/body.js'
import { retrieve } from '../../common/rag/retrieve.js'
import { tune, parseTune, changes } from '../../common/rag/options.js'
import { ASK_CONFIG, RAG_CONFIG } from '../../../config/preferences.js'
import { answer } from '../answer.js'
import { renderAsk, renderTurn } from '../render.js'

/**
 * Ask routes, mounted at /ask. The owner only: an answer spends the local
 * model's time. POST takes a form (or JSON) and answers with the page, or,
 * for a script asking for JSON, with the new turn's HTML and the answer text.
 */

const asArray = value => [].concat(value ?? [])

function history (raw) {
  try {
    const list = JSON.parse(String(raw ?? '[]'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

const BASE = { ...RAG_CONFIG, ...ASK_CONFIG.retrieval }

export function registerRoutes (router, { services, registry, tabs, providers }) {
  const ready = providers.length > 0
  const where = providers.filter(p => p.remote).map(p => p.name)
  const state = new Map() // provider → cooling down or dropped, between questions
  const refuse = ({ response, url, session }, json = false) => {
    if (session.user) return false
    if (json) send(response, 401, { error: 'Log in, or send the write token' })
    else redirect(response, 303, `/login?return=${encodeURIComponent(url.pathname)}`)
    return true
  }

  router.get('/ask', ctx => {
    if (refuse(ctx)) return
    return sendHtml(ctx.response, 200, renderAsk({ tabs, session: ctx.session, ready, where }))
  })

  router.add(['POST'], '/ask', async ctx => {
    const { request, response, session } = ctx
    const json = wantsJson(request)
    const body = await readBody(request)
    const check = services.auth.authorise(request, body)
    if (!check.ok) return refuse(ctx, json) || send(response, check.status, { error: check.error })

    const question = String(body.q ?? '').trim().slice(0, ASK_CONFIG.maxQuestion)
    if (!question) return send(response, 400, { error: 'Ask a question' })
    const { pairs, unknown } = parseTune(body.tune)
    for (const name of ['similar', 'communities']) if (asArray(body[name]).length) pairs.push([name, '1'])
    const config = tune(pairs, BASE)
    const contextOnly = Boolean(asArray(body.contextOnly).length)

    const retrieval = await retrieve(question, { registry, related: services.related, links: services.links, topics: services.topics, hashtags: services.hashtags, communities: services.communities, config })
    const reply = contextOnly ? null : await answer({ providers, state, question, retrieval, history: history(body.history) })
    const turn = { n: Math.max(1, Math.min(999, Number(body.turn) || 1)), question, retrieval, answer: reply, by: reply?.by ?? null, changes: changes(config, BASE), unknown }

    if (json) return send(response, 200, { html: renderTurn(turn), answer: reply?.text ?? null, error: reply?.error ?? null })
    const values = { q: '', tune: body.tune ?? '', similar: config.similarity.enabled, communities: config.communities.enabled, contextOnly }
    return sendHtml(response, 200, renderAsk({ turns: [turn], values, tabs, session, ready, where }))
  })
}

export default registerRoutes
