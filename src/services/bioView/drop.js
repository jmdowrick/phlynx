/**
 * What dropping something in the physiological view changes, as new data.bioView values. Nothing here
 * writes: the caller applies the plan as one undo step.
 */

import { FACET_PARTS } from './geometry.js'

/** Fields that place a node; Re-layout clears them and keeps the user's choices of what it is. */
const PLACEMENT_KEYS = ['cell', 'facet', 'at', 'order', 'position', 'rect']

/**
 * Merges a patch into a bioView, dropping fields set to undefined.
 *
 * @param {Object|undefined} bioView
 * @param {Object} patch
 * @returns {Object}
 */
export function patchBioView(bioView, patch) {
  return Object.fromEntries(Object.entries({ ...bioView, ...patch }).filter(([, value]) => value !== undefined))
}

/**
 * Gives every cell's slots as drop targets.
 *
 * @param {Map<string, Object>} layout - From layoutBioView.
 * @returns {Array<{id: string, rect: Object, counts: Object}>} For nearestSlot.
 */
export function dropTargets(layout) {
  const cells = new Map()
  for (const [id, place] of layout) if (place.kind === 'cell') cells.set(id, { id, rect: place.rect, counts: Object.fromEntries(FACET_PARTS.map((part) => [part, 0])) })
  for (const place of layout.values()) if (place.kind === 'protein' && cells.has(place.cell)) cells.get(place.cell).counts[place.part]++
  return [...cells.values()]
}

/**
 * The proteins on one part of a cell's membrane, in slot order.
 *
 * @param {Map<string, Object>} layout
 * @param {string} cell
 * @param {string} part - One of FACET_PARTS.
 * @returns {string[]}
 */
function onPart(layout, cell, part) {
  return [...layout]
    .filter(([, place]) => place.kind === 'protein' && place.cell === cell && place.part === part)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([id]) => id)
}

/**
 * Plans dropping a node into a membrane slot: it takes the slot, the proteins after it move along,
 * and the part it left closes up. Every protein on a part that changes gets its order and side
 * written, so the result doesn't depend on how the rest would be sorted.
 *
 * @param {Object} options
 * @param {string} options.id - The dropped node.
 * @param {{cellId: string, part: string, facet: string, at?: string, order: number}} options.slot - From nearestSlot.
 * @param {Map<string, Object>} options.layout - The layout before the drop.
 * @param {Map<string, Object>} options.roles - Node id -> resolveBioRole's result.
 * @param {Map<string, Object>} options.bioViews - Node id -> its data.bioView.
 * @returns {Map<string, Object>} Node id -> its new bioView.
 */
export function planSlotDrop({ id, slot, layout, roles, bioViews }) {
  const plan = new Map()
  const from = layout.get(id)
  const write = (nodeId, patch) => plan.set(nodeId, patchBioView(plan.get(nodeId) ?? bioViews.get(nodeId), patch))

  // A lateral protein's side is written with its order, so it stays on the side it was drawn on.
  const place = (part) => (part.startsWith('lateral-') ? { at: part.slice('lateral-'.length) } : {})
  if (from?.kind === 'protein' && (from.cell !== slot.cellId || from.part !== slot.part)) {
    onPart(layout, from.cell, from.part)
      .filter((other) => other !== id)
      .forEach((other, order) => write(other, { order, ...place(from.part) }))
  }
  const target = onPart(layout, slot.cellId, slot.part).filter((other) => other !== id)
  target.splice(Math.min(slot.order, target.length), 0, id)
  target.forEach((other, order) => write(other, { order, ...place(slot.part) }))

  const role = roles.get(id)?.role
  write(id, {
    cell: slot.cellId,
    facet: slot.facet,
    at: slot.facet === 'lateral' ? slot.at : undefined,
    position: undefined,
    // Dropped into a membrane, anything becomes a membrane protein.
    role: role === 'membraneProtein' ? bioViews.get(id)?.role : 'membraneProtein',
  })
  return plan
}

/**
 * Plans taking a protein out of its membrane, to wherever it was dropped.
 *
 * @param {Object} options
 * @param {string} options.id
 * @param {{x: number, y: number}} options.position - Its new top-left.
 * @param {Map<string, Object>} options.layout
 * @param {Map<string, Object>} options.bioViews
 * @returns {Map<string, Object>}
 */
export function planUnplace({ id, position, layout, bioViews }) {
  const plan = new Map()
  const from = layout.get(id)
  if (from?.kind === 'protein') {
    onPart(layout, from.cell, from.part)
      .filter((other) => other !== id)
      .forEach((other, order) => plan.set(other, patchBioView(bioViews.get(other), { order })))
  }
  plan.set(id, patchBioView(bioViews.get(id), { facet: null, at: undefined, order: undefined, cell: undefined, position }))
  return plan
}

/**
 * Plans laying the whole view out again: every node goes back to the place its annotations and the
 * layout give it, keeping the user's role and glyph.
 *
 * @param {Map<string, Object>} bioViews - Node id -> its data.bioView.
 * @returns {Map<string, Object>} Only the nodes that change.
 */
export function planRelayout(bioViews) {
  const plan = new Map()
  for (const [id, bioView] of bioViews) {
    if (!bioView || !PLACEMENT_KEYS.some((key) => key in bioView)) continue
    plan.set(id, Object.fromEntries(Object.entries(bioView).filter(([key]) => !PLACEMENT_KEYS.includes(key))))
  }
  return plan
}
