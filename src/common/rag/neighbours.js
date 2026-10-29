/** A node's nearest embedding neighbours: embeds its passage (cached) and asks the related index. → async iri → [{ iri, score }] */
export const neighbours = (related, registry, { k, minScore }) => async iri => {
  const passage = await registry.passage(iri)
  if (!passage) return []
  try { return await related.related(iri, passage.text, { k, minScore }) } catch { return [] }
}

export default neighbours
