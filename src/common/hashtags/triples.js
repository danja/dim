import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri, literal } from '../store/SPARQLHelper.js'

/**
 * Hashtags as SKOS. Every tag is a skos:Concept in the scheme dim:hashtags,
 * its label the tag as typed (lower-case); #a/b is narrower than #a. A
 * resource that uses a tag has dim:hashtag (a sub-property of dcterms:subject)
 * to its concept. All of it lives in graph:facet/links.
 */

const { dim, rdf, rdfs, skos } = NAMESPACES

export const HASHTAG_SCHEME = `${dim}hashtags`
export const HASHTAG_PREDICATE = `${dim}hashtag`

/** 'music/synth' → http://purl.org/stuff/dim/concept/tag-music--synth */
export const tagIri = tag => `${dim}concept/tag-${tag.replaceAll('/', '--')}`

/** The tag a concept IRI stands for, or null. */
export function tagOf (conceptIri) {
  const s = String(conceptIri ?? '')
  const prefix = `${dim}concept/tag-`
  return s.startsWith(prefix) ? s.slice(prefix.length).replaceAll('--', '/') : null
}

export const schemeTriples = () => [
  `${iri(HASHTAG_SCHEME)} ${iri(rdf + 'type')} ${iri(skos + 'ConceptScheme')} .`,
  `${iri(HASHTAG_SCHEME)} ${iri(rdfs + 'label')} ${literal('DIM hashtags')} .`
]

/** The concept for one tag; #a/b is skos:broader #a. */
export function conceptTriples (tag) {
  const c = iri(tagIri(tag))
  const slash = tag.lastIndexOf('/')
  const triples = [
    `${c} ${iri(rdf + 'type')} ${iri(skos + 'Concept')} .`,
    `${c} ${iri(skos + 'inScheme')} ${iri(HASHTAG_SCHEME)} .`,
    `${c} ${iri(skos + 'prefLabel')} ${literal(tag)} .`
  ]
  if (slash !== -1) triples.push(`${c} ${iri(skos + 'broader')} ${iri(tagIri(tag.slice(0, slash)))} .`)
  return triples
}

/** A tag with nothing above it is a top concept of the scheme (a triple about the scheme). */
export const topConceptTriple = tag => `${iri(HASHTAG_SCHEME)} ${iri(skos + 'hasTopConcept')} ${iri(tagIri(tag))} .`

export const usageTriples = (resource, tags) => tags.map(t => `${iri(resource)} ${iri(HASHTAG_PREDICATE)} ${iri(tagIri(t))} .`)
