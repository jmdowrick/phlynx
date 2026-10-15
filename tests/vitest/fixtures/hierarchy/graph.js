/**
 * Builders for nested test graphs: modules, super-modules, subsystems and edges, as the store holds them.
 */
import { buildSubsystem, buildSupermoduleInterface } from '../../../../src/services/import/buildWorkflow.js'
import { subsystemPorts } from '../../../../src/services/hierarchy/exposure.js'
import { checkAndClaimCouplings, resolvePortCouplings } from '../../../../src/utils/edges.js'
import { EXPOSURE_EDGE_TYPE, MAIN_NODE_TYPE } from '../../../../src/utils/constants.js'
import { nodeIdOf } from '../../../../src/utils/hierarchy.js'

/** A port. */
export const port = (portType, label, variables, multiportType = 'None', extra = {}) => ({ portType, label, variables, multiportType, ...extra })

/** A constant row. */
export const constant = (name, value) => ({ name, type: 'constant', value, units: 'dimensionless' })

/**
 * A module node, in a scope.
 *
 * @param {string} localId
 * @param {string} name
 * @param {Object} [options]
 * @param {string|null} [options.scope=null]
 * @param {Array} [options.ports=[]]
 * @param {Array} [options.variables=[]]
 * @param {Object} [options.data] - More data.
 * @returns {Object}
 */
export function module(localId, name, { scope = null, ports = [], variables = [], data = {} } = {}) {
  return {
    id: nodeIdOf(scope, localId),
    type: MAIN_NODE_TYPE,
    position: { x: 0, y: 0 },
    data: { scope, localId, name, mathRef: 'file:m', moduleRef: 'm:m', variables, ports, handles: [], ...data },
  }
}

/**
 * A super-module's interface node. What it exposes is drawn as exposure edges (see exposures).
 *
 * @param {string} smId
 * @param {string} name
 * @param {Object} [definition] - As buildSupermoduleInterface's.
 * @returns {Object}
 */
export function supermodule(smId, name, definition = {}) {
  if ('exposedPorts' in definition) throw new Error('Exposed ports are exposure edges: use exposures().')
  return buildSupermoduleInterface(smId, { name, ...definition })
}

/**
 * An exposed port aliasing a child's port, as exposures takes it.
 *
 * @param {string} id
 * @param {string} child - The child's local id.
 * @param {string} portType
 * @param {string} label
 * @param {Object} [options] - slot, via (then only via is kept) and label.
 * @returns {Object}
 */
export const exposed = (id, child, portType, label, { slot = 0, via, label: own } = {}) => ({
  id,
  alias: { child, ...(via ? { via } : { portType, label, slot }) },
  ...(own && { label: own }),
})

/**
 * The exposure edges exposing a super-module's ports: one from each child to its interface, as the canvas draws them,
 * each port's order its place in the list.
 *
 * @param {string} smId
 * @param {Array} ports - From exposed.
 * @returns {Array} The edges, in the order their children first appear.
 */
export function exposures(smId, ports) {
  const byChild = new Map()
  ports.forEach(({ id, alias: { child, ...alias }, label }, order) => {
    if (!byChild.has(child)) byChild.set(child, [])
    byChild.get(child).push({ id, alias, ...(label && { label }), order })
  })
  return [...byChild].map(([child, exposed]) => {
    const source = nodeIdOf(smId, child)
    return { id: `${source}--${smId}`, type: EXPOSURE_EDGE_TYPE, source, target: smId, data: { exposed } }
  })
}

/**
 * A subsystem, its ports built from its super-module as the store holds it.
 *
 * @param {Array|{nodes: Array, edges: Array}} store - The store's nodes so far, its super-module's included, and its
 *   edges, its exposure edges included; nodes alone for a super-module exposing nothing.
 * @param {string} localId
 * @param {string} name
 * @param {string} smId
 * @param {Object} [options] - scope and overrides.
 * @returns {Object}
 */
export function subsystem(store, localId, name, smId, { scope = null, overrides = {} } = {}) {
  const { nodes, edges = [] } = Array.isArray(store) ? { nodes: store } : store
  return buildSubsystem(nodeIdOf(scope, localId), name, smId, { scope, overrides, ports: subsystemPorts(nodes, edges, smId) })
}

/**
 * Connects two nodes as the canvas does: each label's first free slot, refused when a single-connection slot is taken.
 *
 * @param {Object} source
 * @param {Object} target
 * @param {Object} [options]
 * @param {Set<string>} [options.used] - The slots edges drawn so far hold, shared across a scope.
 * @param {string} [options.id]
 * @param {Array} [options.stored] - Couplings whose slots to prefer, as resolvePortCouplings's.
 * @returns {Object}
 */
export function connect(source, target, { used = new Set(), id = `${source.id}--${target.id}`, stored = [] } = {}) {
  const couplings = resolvePortCouplings(source.data.ports, target.data.ports, { sourceId: source.id, targetId: target.id, usedPortKeys: used, stored })
  if (!couplings.length) throw new Error(`No couplings from "${source.data.name}" to "${target.data.name}".`)
  const { valid, conflicts } = checkAndClaimCouplings(source.id, target.id, couplings, used)
  if (!valid) throw new Error(conflicts.join(' '))
  return { id, type: 'smoothstep', source: source.id, target: target.id, data: { couplings } }
}

/**
 * Shuffles a copy of a list, the same way each time.
 *
 * @param {Array} items
 * @param {number} [seed=1]
 * @returns {Array}
 */
export function shuffled(items, seed = 1) {
  const copy = [...items]
  let state = seed
  const random = () => ((state = (state * 16807) % 2147483647) - 1) / 2147483646
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
