import { randomBytes } from 'crypto'
import { NAMESPACES } from '../common/rdf/NamespaceManager.js'
import { iri, literal, typedLiteral } from '../common/store/SPARQLHelper.js'
import { decimalLiteral } from '../common/store/positions.js'
import { STATES, STATE_LABELS } from './tasks.js'

/** Task triples, IRIs and the task-state scheme (graph:facet/farelo). */

const { dim, rdf, rdfs, dcterms, skos, xsd } = NAMESPACES

export const P = Object.freeze({
  type: rdf + 'type',
  title: dcterms + 'title',
  created: dcterms + 'created',
  modified: dcterms + 'modified',
  note: dim + 'note',
  tag: dim + 'tag',
  status: dim + 'status',
  priority: dim + 'priority',
  due: dim + 'due',
  estimate: dim + 'estimate',
  dependsOn: dim + 'dependsOn',
  partOf: dim + 'partOf',
  position: dim + 'position',
  doneAt: dim + 'doneAt',
  archivedAt: dim + 'archivedAt'
})

/** Every predicate a task write owns (a write replaces them all). */
export const TASK_PREDICATES = Object.freeze(Object.values(P))

export const C = Object.freeze({ Task: dim + 'Task', Project: dim + 'Project' })
export const SCHEME = `${dim}task-states`
export const stateIri = state => `${dim}task-state/${state}`
export const stateOf = value => String(value ?? '').replace(/^.*\//, '')
export const taskIri = id => `${dim}task/${id}`
export const newTaskId = () => `t${randomBytes(6).toString('hex')}`

/** The whole description of a task — writes replace every owned predicate. */
export function taskTriples (t) {
  const s = iri(t.iri)
  const add = (p, o) => `${s} ${iri(p)} ${o} .`
  const triples = [
    add(P.type, iri(C.Task)),
    add(P.title, literal(t.title)),
    add(P.status, iri(stateIri(t.status))),
    add(P.position, decimalLiteral(t.position)),
    add(P.created, typedLiteral(new Date(t.created)))
  ]
  if (t.isProject) triples.push(add(P.type, iri(C.Project)))
  if (t.modified) triples.push(add(P.modified, typedLiteral(new Date(t.modified))))
  if (t.note) triples.push(add(P.note, literal(t.note)))
  if (t.priority != null) triples.push(add(P.priority, typedLiteral(t.priority)))
  if (t.due) triples.push(add(P.due, literal(t.due, { datatype: `${xsd}date` })))
  if (t.estimate != null) triples.push(add(P.estimate, typedLiteral(t.estimate)))
  if (t.project) triples.push(add(P.partOf, iri(t.project)))
  if (t.doneAt) triples.push(add(P.doneAt, typedLiteral(new Date(t.doneAt))))
  if (t.archivedAt) triples.push(add(P.archivedAt, typedLiteral(new Date(t.archivedAt))))
  for (const dep of t.dependsOn ?? []) triples.push(add(P.dependsOn, iri(dep)))
  for (const tag of t.tags ?? []) triples.push(add(P.tag, literal(tag)))
  return triples
}

/** The SKOS scheme of task states, for graph:alignment/task-states. */
export function schemeTriples () {
  const triples = [
    `${iri(SCHEME)} ${iri(rdf + 'type')} ${iri(skos + 'ConceptScheme')} .`,
    `${iri(SCHEME)} ${iri(rdfs + 'label')} ${literal('DIM task states')} .`
  ]
  STATES.forEach((state, i) => {
    const c = iri(stateIri(state))
    triples.push(`${c} ${iri(rdf + 'type')} ${iri(skos + 'Concept')} .`)
    triples.push(`${c} ${iri(skos + 'inScheme')} ${iri(SCHEME)} .`)
    triples.push(`${c} ${iri(skos + 'prefLabel')} ${literal(STATE_LABELS[state])} .`)
    triples.push(`${c} ${iri(skos + 'notation')} ${literal(String(i + 1))} .`)
  })
  return triples
}
