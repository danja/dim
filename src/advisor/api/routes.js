import { sendHtml } from '../../common/http/respond.js'
import { writeRoute } from '../../common/http/write.js'
import { cleanContext } from '../Advisor.js'
import { DEFAULT_WEIGHTS } from '../score.js'
import { explain } from '../explain.js'
import { renderNext, contextQuery } from './page.js'

/** /farelo/next — mounted by the Farelo facet when an advisor is given. */

export function registerAdvisorRoutes (router, { advisor, explainImpl = explain, tabs }) {
  const view = async (query, session, extra = {}) => {
    const suggestion = await advisor.suggest(query)
    const related = suggestion.ranked[0] ? await advisor.related(suggestion.ranked[0].task) : []
    return renderNext({ ...suggestion, related, query, tabs, session, ...extra })
  }

  router.get('/farelo/next', async ({ response, url, session }) =>
    sendHtml(response, 200, await view(cleanContext(Object.fromEntries(url.searchParams)), session)))

  router.add(['POST'], /^\/farelo\/next\/([a-z0-9]+)\/(accept|skip)$/, writeRoute(async ({ match, body, identity }) => {
    const query = cleanContext(body)
    const shown = String(body.shown ?? '').split(',').filter(Boolean)
    if (match[2] === 'accept') {
      const task = await advisor.accept(match[1], { ...query, shown, actor: identity.user })
      return { redirect: `/farelo/task/${task.id}`, json: { ok: true, id: task.id, status: 'doing' } }
    }
    await advisor.skip(match[1], { rank: Number(body.rank) || null, actor: identity.user })
    return { redirect: `/farelo/next${contextQuery(query)}`, json: { ok: true } }
  }))

  router.add(['POST'], '/farelo/next/explain', writeRoute(async ({ body, session }) => {
    const query = cleanContext(body)
    const { ranked } = await advisor.suggest(query)
    const explanation = await explainImpl(ranked, query)
    return { html: await view(query, session, { explanation }), json: explanation }
  }))

  router.add(['POST'], '/farelo/next/weights/reset', writeRoute(async ({ identity }) => {
    await advisor.advice.saveWeights({ ...DEFAULT_WEIGHTS }, identity.user)
    return { redirect: '/farelo/next', json: { ok: true } }
  }))
}

export default registerAdvisorRoutes
