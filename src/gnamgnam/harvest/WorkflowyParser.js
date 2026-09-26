import fs from 'fs'
import { parseOutline, walkOutline, extractLinks, plainText } from '../../common/outline/OutlineParser.js'

/**
 * Links in data/workflowy.md, one row per occurrence:
 * [{ url, linkText, context, sourceLine }]. Dedup happens in the harvester
 * (first link text wins, contexts merged).
 *
 * Built on the shared outline parser, so context is the item's real
 * ancestors ("Inbox / Synths") and link titles Workflowy wrapped across
 * lines are read whole.
 */

const CONTEXT_PART_MAX = 80
const CONTEXT_MAX = 300

function contextOf (ancestors) {
  const parts = ancestors
    .map(a => plainText(a.text))
    .filter(Boolean)
    .map(t => t.length > CONTEXT_PART_MAX ? `${t.slice(0, CONTEXT_PART_MAX - 1)}…` : t)
  return parts.join(' / ').slice(0, CONTEXT_MAX) || null
}

export function parseWorkflowy (text) {
  const rows = []
  walkOutline(parseOutline(text).items, (item, ancestors) => {
    const context = contextOf(ancestors)
    for (const link of extractLinks(item.text)) {
      rows.push({ url: link.url, linkText: link.text, context, sourceLine: item.line })
    }
  })
  return rows
}

export async function parseWorkflowyFile (file) {
  return parseWorkflowy(await fs.promises.readFile(file, 'utf8'))
}

export function deduplicate (rows) {
  const byUrl = new Map()
  for (const row of rows) {
    const key = row.url
    if (!byUrl.has(key)) {
      byUrl.set(key, { ...row, occurrences: 1 })
    } else {
      const prev = byUrl.get(key)
      prev.occurrences += 1
      if (!prev.linkText && row.linkText) prev.linkText = row.linkText
      if (!prev.context && row.context) prev.context = row.context
    }
  }
  return [...byUrl.values()]
}

export default parseWorkflowy
