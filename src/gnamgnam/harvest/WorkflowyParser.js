import fs from 'fs'

/**
 * Parse data/workflowy.md for markdown links.
 * Returns [{ url, linkText, context, sourceLine }] with one row per link
 * occurrence; dedup happens in the harvester (first link text wins, contexts
 * merged).
 */

const LINK_RE = /\[([^\]]*)\]\((https?:[^)\s]+)\)/g

export function parseWorkflowy (text) {
  const rows = []
  const lines = text.split('\n')
  // Outline context: track the most recent non-link heading-ish lines.
  const stack = []
  lines.forEach((line, i) => {
    const indent = line.match(/^\s*/)[0].length
    const stripped = line.trim().replace(/^[-*]\s*/, '')
    if (stripped && !stripped.includes('http')) {
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
      if (stripped.length < 120) stack.push({ indent, text: stripped.slice(0, 120) })
    }
    let m
    LINK_RE.lastIndex = 0
    const matches = [...line.matchAll(/\[([^\]]*)\]\((https?:[^)\s]+)\)/g)]
    for (m of matches) {
      const linkText = (m[1] || '').trim()
      const url = m[2].trim().replace(/[),.]+$/, '')
      // Skip self-links where text duplicates a bare URL; keep the URL.
      rows.push({
        url,
        linkText: linkText === url ? '' : linkText,
        context: stack.map(s => s.text).join(' / ').slice(0, 300) || null,
        sourceLine: i + 1
      })
    }
    // Bare URLs not in markdown form.
    const rest = line.replace(/\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '')
    for (const b of rest.matchAll(/(https?:\/\/[^\s)>\]]+)/g)) {
      const url = b[1].replace(/[),.]+$/, '')
      rows.push({
        url,
        linkText: '',
        context: stack.map(s => s.text).join(' / ').slice(0, 300) || null,
        sourceLine: i + 1
      })
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
