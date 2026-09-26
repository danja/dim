/** Tag lists → Map tag → how many carry it (for a facet's tags() hook). */
export function countTags (lists) {
  const out = new Map()
  for (const tags of lists) for (const t of tags ?? []) out.set(t, (out.get(t) ?? 0) + 1)
  return out
}
