/**
 * Fractional ordering for lists stored as RDF (outline siblings, board
 * columns): each item has a decimal position; inserting between two items
 * takes the midpoint, so one move rewrites one item. When neighbours get
 * closer than MIN_GAP the list is respread (1, 2, 3 …).
 */

import { literal } from './SPARQLHelper.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'

export const MIN_GAP = 1e-6

/** A position strictly between `before` and `after` (either may be null). */
export function positionBetween (before, after) {
  if (before == null && after == null) return 1
  if (before == null) return after - 1
  if (after == null) return before + 1
  return (before + after) / 2
}

export function needsRenumber (before, after) {
  return before != null && after != null && after - before < MIN_GAP
}

/** Evenly spaced positions for a list: 1, 2, 3 … → [{ node, position }] */
export function renumber (items) {
  return items.map((node, i) => ({ node, position: i + 1 }))
}

/** A decimal literal, never in exponent form (xsd:decimal forbids it). */
export function decimalLiteral (n) {
  if (!Number.isFinite(n)) throw new Error(`Not a finite position: ${n}`)
  const text = Number.isInteger(n) ? `${n}.0` : n.toFixed(12).replace(/0+$/, '')
  return literal(text, { datatype: `${NAMESPACES.xsd}decimal` })
}
