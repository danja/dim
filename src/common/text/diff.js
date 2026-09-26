/**
 * Line diff (longest common subsequence), for page history. Pages are
 * small; beyond MAX_CELLS of work it reports "too large" rather than
 * spending the time.
 *
 * → [{ op: ' ' | '+' | '-', line }]
 */

export const MAX_CELLS = 4_000_000

export function diffLines (before, after) {
  const a = String(before ?? '').split('\n')
  const b = String(after ?? '').split('\n')
  if (a.length * b.length > MAX_CELLS) return null
  // lengths[i][j]: LCS length of a[i:] and b[j:]
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }
  const out = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ op: ' ', line: a[i] }); i++; j++ } else if (lengths[i + 1][j] >= lengths[i][j + 1]) { out.push({ op: '-', line: a[i++] }) } else { out.push({ op: '+', line: b[j++] }) }
  }
  while (i < a.length) out.push({ op: '-', line: a[i++] })
  while (j < b.length) out.push({ op: '+', line: b[j++] })
  return out
}

/** Counts of added and removed lines. */
export function diffStats (diff) {
  return { added: diff.filter(d => d.op === '+').length, removed: diff.filter(d => d.op === '-').length }
}
