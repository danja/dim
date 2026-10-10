import { send, sendHtml } from '../../common/http/respond.js'
import { negotiate } from '../../common/http/negotiate.js'
import { writeRoute } from '../../common/http/write.js'
import { resolveMentions } from '../../common/links/mentions.js'
import { parseHashtags } from '../../common/hashtags/parse.js'
import { renderBoard } from './boardPage.js'
import { renderTaskPage } from './taskPage.js'
import { renderArchived } from './archivedPage.js'
import { renderDicePage } from './dicePage.js'
import { taskPath } from './common.js'
import { rankForDice } from '../tasks.js'
import { diceList, pick, nextState, POLICIES } from '../dice.js'
import { resolvedLinks } from '../../common/links/resolvedLinks.js'
import { gatherProject } from './projectHub.js'
import { relatedFor } from '../../common/related/relatedFor.js'

/** Farelo HTTP routes, mounted at /farelo. */

const ID = '(t[a-f0-9]+)'
const list = value => [].concat(value ?? []).map(String).filter(Boolean)
const notFound = () => Object.assign(new Error('No such task'), { status: 404 })

export function registerRoutes (router, { store, rolls, rng = Math.random, tabs, services, registry, origin }) {
  const find = async id => (await store.get(id)) ?? Promise.reject(notFound())
  const syncMentions = async (task, actor) => {
    if (!services.links) return
    const targets = await resolveMentions(task.note ?? '', { registry, origin })
    await services.links.syncMentions({ from: task.iri, targets, actor })
    await services.links.syncHashtags({ from: task.iri, tags: parseHashtags(task.title, task.note), actor })
  }

  router.get('/farelo', async ({ response, url, session }) =>
    sendHtml(response, 200, renderBoard({
      tasks: await store.list(),
      projectId: url.searchParams.get('project') || null,
      allDone: url.searchParams.get('done') === 'all',
      tabs,
      session
    })))

  router.get('/farelo/archived', async ({ response, session }) =>
    sendHtml(response, 200, renderArchived({ tasks: await store.listArchived(), tabs, session })))

  router.get(new RegExp(`^/farelo/task/${ID}(\\.json)?$`), async ({ request, response, match, session }) => {
    const task = await store.get(match[1])
    if (!task) return send(response, 404, { error: 'No such task', id: match[1] })
    if (negotiate(match[2], request.headers.accept) !== 'html') return send(response, 200, task)
    const [links, historyEntries] = await Promise.all([resolvedLinks({ services, registry }, task.iri), store.history(task).catch(() => [])])
    const all = await store.list()
    let hub = null
    if (task.isProject || all.some(t => t.project === task.iri)) {
      const taskLinks = new Map()
      for (const child of all.filter(t => t.project === task.iri)) taskLinks.set(child.iri, await resolvedLinks({ services, registry }, child.iri))
      hub = gatherProject({ project: task, tasks: all, links, taskLinks })
    }
    return sendHtml(response, 200, renderTaskPage({ task, tasks: all, links, hub, related: await relatedFor({ services, registry }, task.iri, [task.title, task.note].filter(Boolean).join('\n\n')), historyEntries, tabs, session }))
  })

  router.get('/farelo/dice', async ({ response, session }) =>
    sendHtml(response, 200, renderDicePage({ list: diceList(rankForDice(await store.list())), tabs, session })))

  // ── Writes ───────────────────────────────────────────────────────────

  router.add(['POST'], '/farelo/tasks', writeRoute(async ({ body, identity }) => {
    const task = await store.create(body, identity.user)
    if (task.note || parseHashtags(task.title).length) await syncMentions(task, identity.user)
    return { redirect: '/farelo/', json: { ok: true, task } }
  }))

  router.add(['POST'], new RegExp(`^/farelo/task/${ID}$`), writeRoute(async ({ match, body, identity }) => {
    const fields = {}
    for (const key of ['title', 'note', 'priority', 'due', 'estimate', 'tags', 'project', 'isProject', 'dependsOn']) if (key in body) fields[key] = body[key]
    const task = await store.update(await find(match[1]), fields, identity.user)
    if ('note' in fields || 'title' in fields) await syncMentions(task, identity.user)
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

  router.add(['POST'], new RegExp(`^/farelo/task/${ID}/archive$`), writeRoute(async ({ match, identity }) => {
    const task = await store.archive(await find(match[1]), identity.user)
    return { redirect: '/farelo/', json: { ok: true, task } }
  }))

  router.add(['POST'], new RegExp(`^/farelo/task/${ID}/restore$`), writeRoute(async ({ match, identity }) => {
    const task = await store.restore(await find(match[1]), identity.user)
    return { redirect: taskPath(task), json: { ok: true, task } }
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
