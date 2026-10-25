import { randomInt } from 'node:crypto'
import { saveBookmark } from '../gnamgnam/saveBookmark.js'

/**
 * Quick capture: one box, and what was typed (or shared from a phone)
 * decides where it lands.
 *
 *   "todo call Ann" / "task: …" / "- [ ] …"   → a Farelo task (To do)
 *   a URL (typed, or shared with a title)      → a GnamGnam bookmark
 *   anything else                               → a note: a new wiki page, and an entry
 *                                                 under the Trestle outline "Inbox" linking to it
 *
 * `kind` forces the choice. For tasks and bookmarks the first line is the
 * title and the rest a note. A note's title is the optional Title field; without
 * one the page is titled by its random number, and all the text is its content.
 */

export const KINDS = Object.freeze(['auto', 'bookmark', 'task', 'note'])
export const INBOX_TITLE = 'Inbox'
const INBOX_SLUG = 'inbox'
const URL_IN_TEXT = /https?:\/\/[^\s<>"]+/i
const TASK_PREFIX = /^\s*(?:todo|task)\b[:\s]*|^\s*-\s*\[\s?\]\s*/i

export class CaptureError extends Error {
  constructor (message, status = 400) {
    super(message)
    this.name = 'CaptureError'
    this.status = status
  }
}

/** { text, url, title, kind } → { kind, url, title, note } */
export function classify ({ text = '', url = '', title = '', kind = 'auto' } = {}) {
  const raw = String(text ?? '').replace(/\r\n/g, '\n').trim()
  const found = String(url ?? '').trim() || (raw.match(URL_IN_TEXT)?.[0] ?? '')
  const link = found.replace(/[.,;:!?)\]]+$/, '')
  const wanted = KINDS.includes(kind) ? kind : 'auto'
  const isTask = TASK_PREFIX.test(raw)
  const chosen = wanted !== 'auto' ? wanted : isTask ? 'task' : link ? 'bookmark' : 'note'

  const body = (isTask ? raw.replace(TASK_PREFIX, '') : raw)
  const lines = body.split('\n')
  if (chosen === 'bookmark') {
    const rest = body.replace(found, '').split('\n').map(l => l.replace(/^[\s,;:.–—-]+|[\s,;:–—-]+$/g, '')).join('\n').trim()
    const heading = String(title ?? '').trim() || rest.split('\n')[0].trim() || link
    const note = String(title ?? '').trim() ? rest : rest.split('\n').slice(1).join('\n').trim()
    if (!link) throw new CaptureError('A bookmark needs a URL')
    return { kind: 'bookmark', url: link, title: heading.slice(0, 300), note: note || null }
  }
  if (chosen === 'note') {
    const text = [body.trim(), link && !body.includes(link) ? link : ''].filter(Boolean).join('\n\n')
    const heading = String(title ?? '').trim().slice(0, 200)
    if (!heading && !text) throw new CaptureError('Nothing to capture')
    return { kind: 'note', url: link || null, title: heading || null, note: text || null }
  }
  const first = lines[0].trim() || String(title ?? '').trim()
  if (!first && !link) throw new CaptureError('Nothing to capture')
  const note = [lines.slice(1).join('\n').trim(), link && !body.includes(link) ? link : ''].filter(Boolean).join('\n\n')
  return { kind: chosen, url: link || null, title: (first || link).slice(0, 200), note: note || null }
}

/**
 * Carry out a classified capture. deps: { tasks, wiki, outlines, mentions, client,
 * repository, registry }. → { kind, iri, href, label }
 */
export async function capture (item, { tasks, wiki, outlines = null, mentions = null, client, repository, registry, actor }) {
  if (item.kind === 'task') {
    if (!tasks) throw new CaptureError('Tasks (Farelo) are not available', 503)
    const task = await tasks.create({ title: item.title, note: item.note ?? '', status: 'todo', tags: ['squirt'] }, actor)
    return { kind: 'task', iri: task.iri, href: `/farelo/task/${task.id}`, label: task.title }
  }
  if (item.kind === 'bookmark') {
    const saved = await saveBookmark({ url: item.url, title: item.title === item.url ? null : item.title, description: item.note, tags: ['squirt'], context: 'Captured in Squirt', client, repository, actor })
    await registry?.refresh(saved.iri).catch(() => {})
    return { kind: 'bookmark', iri: saved.iri, href: registry?.href(saved.iri) ?? null, label: item.title, existed: !saved.created }
  }
  if (!wiki) throw new CaptureError('The wiki is not available', 503)
  const id = await freeId(wiki, outlines)
  const title = item.title || id
  const page = await wiki.save({ slug: id, title, content: item.note ?? '', tags: ['squirt'], actor })
  await mentions?.sync(page, actor).catch(() => {})
  if (outlines) {
    const inbox = (await outlines.outline(INBOX_SLUG)) ?? await outlines.createOutline({ title: INBOX_TITLE, actor })
    await outlines.createNode(inbox, { id, title: `[${title.replace(/[[\]]/g, '')}](/wiki/page/${id})`, actor })
  }
  return { kind: 'note', iri: page.iri, href: `/wiki/page/${page.slug}`, label: title }
}

/** A random ten-digit number, used by neither a wiki page nor an outline node. */
async function freeId (wiki, outlines) {
  for (;;) {
    const id = String(randomInt(1e9, 1e10))
    if (!(await wiki.get(id)) && !(await outlines?.find(id))) return id
  }
}
