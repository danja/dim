import { send, sendHtml } from '../../common/http/respond.js'
import { negotiate } from '../../common/http/negotiate.js'
import { writeRoute } from '../../common/http/write.js'
import { resolveMentions } from '../../common/links/mentions.js'
import { renderBoard } from './boardPage.js'
import { renderTaskPage } from './taskPage.js'
import { renderDicePage } from './dicePage.js'
import { taskPath } from './common.js'
import { rankForDice } from '../tasks.js'
import { diceList, pick, nextState, POLICIES } from '../dice.js'

/** Farelo HTTP routes, mounted at /farelo. */

const ID = '(t[a-f0-9]+)'
const list = value => [].concat(value ?? []).map(String).filter(Boolean)
const notFound = () => Object.assign(new Error('No such task'), { status: 404 })

async function linksFor ({ services, registry }, resourceIri) {
  if (!services?.links) return null
  try {
    const links = await services.links.linksOf(resourceIri)
    return Promise.all(links.map(async l => ({ ...(await registry.lookup(l.iri)), kind: l.kind, direction: l.direction, iri: l.iri })))
  } catch (error) {
    return { error: error.message }
  }
}

export function registerRoutes (router, { store, rolls, rng = Math.random, tabs, services, registry, origin }) {
  const find = async id => (await store.get(id)) ?? Promise.reject(notFound())
  const syncMentions = async (task, actor) => {
    if (!services.links) return
    const targets = await resolveMentions(task.note ?? '', { registry, origin })
    await services.links.syncMentions({ from: task.iri, targets, actor })
  }

  router.get('/farelo', async ({ response, url, session }) =>
    sendHtml(response, 200, renderBoard({
      tasks: await store.list(),
      projectId: url.searchParams.get('project') || null,
      allDone: url.searchParams.get('done') === 'all',
      tabs,
      session
    })))

  router.get(new RegExp(`^/farelo/task/${ID}(\\.json)?$`), async ({ request, response, match, session }) => {
    const task = await store.get(match[1])
    if (!task) return send(response, 404, { error: 'No such task', id: match[1] })
    if (negotiate(match[2], request.headers.accept) !== 'html') return send(response, 200, task)
    const [links, historyEntries] = await Promise.all([linksFor({ services, registry }, task.iri), store.history(task).catch(() => [])])
    return sendHtml(response, 200, renderTaskPage({ task, tasks: await store.list(), links, historyEntries, tabs, session }))
  })

  router.get('/farelo/dice', async ({ response, session }) =>
    sendHtml(response, 200, renderDicePage({ list: diceList(rankForDice(await store.list())), tabs, session })))

  // ── Writes ───────────────────────────────────────────────────────────

  router.add(['POST'], '/farelo/tasks', writeRoute(async ({ body, identity }) => {
    const task = await store.create(body, identity.user)
    if (task.note) await syncMentions(task, identity.user)
    return { redirect: '/farelo/', json: { ok: true, task } }
  }))

  router.add(['POST'], new RegExp(`^/farelo/task/${ID}$`), writeRoute(async ({ match, body, identity }) => {
    const fields = {}
    for (const key of ['title', 'note', 'priority', 'due', 'estimate', 'tags', 'project', 'isProject', 'dependsOn']) if (key in body) fields[key] = body[key]
    const task = await store.update(await find(match[1]), fields, identity.user)
    if ('note' in fields) await syncMentions(task, identity.user)
    return { redirect: taskPath(task), json: { ok: true, task } }
  }))

  router.add(['POST'], new RegExp(`^/farelo/task/${ID}/move$`), writeRoute(async ({ match, body, identity }) => {
    const task = await store.move(await find(match[1]), {
      status: body.status ? String(body.status) : undefined,
      before: body.before ? String(body.before) : null,
      after: body.after ? String(body.after) : null
    }, identity.user)
    return { redirect: '/farelo/', json: { ok: true, task } }
  }))

  router.add(['POST'], new RegExp(`^/farelo/task/${ID}/delete$`), writeRoute(async ({ match, identity }) => {
    await store.delete(await find(match[1]), identity.user)
    return { redirect: '/farelo/', json: { ok: true } }
  }))

  /**
   * Roll. The form carries the state of the round so far (tasks taken out,
   * numbers skipped, the last pick); the chosen policy turns that into the
   * state for this roll.
   */
  router.add(['POST'], '/farelo/dice', writeRoute(async ({ body, identity, tabs: t, session }) => {
    const policy = POLICIES.includes(body.policy) ? body.policy : 'replace'
    let state = { exclude: list(body.exclude), skip: list(body.skip).map(Number) }
    if (body.lastTask && body.lastTarget) {
      state = nextState(state, { task: { id: String(body.lastTask) }, target: Number(body.lastTarget) }, policy)
    }
    const numbered = diceList(rankForDice(await store.list(), { exclude: state.exclude }))
    const picked = pick(numbered, rng, { skipTargets: state.skip })
    if (picked && rolls) {
      await rolls.record({ actor: identity.user, dice: picked.dice, sum: picked.sum, picked: picked.entry.task.iri, rank: picked.entry.rank, policy, listSize: numbered.length })
    }
    const json = { ok: true, picked: picked ? { dice: picked.dice, sum: picked.sum, rolls: picked.rolls, rank: picked.entry.rank, target: picked.entry.target, task: picked.entry.task } : null, state }
    return { json, html: renderDicePage({ list: numbered, picked, state, policy, tabs: t, session }) }
  }))
}

export default registerRoutes
