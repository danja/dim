import { plainText } from '../common/outline/OutlineParser.js'
import { toMarkdown } from '../trestle/tree.js'
import { PostError } from './PostStore.js'

/**
 * A draft's starting point: a wiki page (title, text, tags) or an outline
 * item (its title; its note, then everything under it as a Markdown list),
 * or a whole outline. → { title, content, tags, derivedFrom }
 */
export async function draftFrom (sourceIri, { wiki = null, outlines = null }) {
  const page = await wiki?.byIri(sourceIri)
  if (page) return { title: page.title, content: page.content, tags: page.tags, derivedFrom: page.iri }

  const found = await outlines?.byIri(sourceIri)
  if (found?.node) {
    const { outline, node } = found
    const list = toMarkdown(outline, node.iri)
    return { title: plainText(node.title) || 'Untitled', content: [node.note, list].filter(s => s?.trim()).join('\n\n'), tags: [], derivedFrom: node.iri }
  }
  if (found) return { title: found.outline.title, content: toMarkdown(found.outline, found.outline.iri), tags: [], derivedFrom: found.outline.iri }

  throw new PostError('A post can start from a wiki page or an outline item; that is neither', 422)
}
