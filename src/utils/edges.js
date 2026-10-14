
/**
 * edges.js
 *
 * Utilities for resolving which port labels are coupled across a conduit edge,
 * and for enforcing the non-multiport single-connection constraint.
 *
 * Core concepts
 * -------------
 * - A conduit edge is a single VueFlow edge between two module nodes.
 * - The CellML variable connections implied by a conduit are determined by
 *   matching port labels between the two nodes with compatible portTypes.
 * - Port type compatibility (source → target):
 *     exit_ports    → entrance_ports | general_ports
 *     general_ports → entrance_ports | exit_ports | general_ports
 *   (entrance_ports on the source side cannot initiate a coupling)
 *
 * Slot assignment
 * ---------------
 * A label may appear more than once under one portType (e.g. a module with two
 * exit "vessel_port"s). Each occurrence is a slot, identified by its index in
 * that (portType, label) group. A coupling takes the group's first slot that is
 * multiport or not yet held by another edge, so slots depend on which edges
 * already exist, not on any edge's position:
 *
 *   exit vessel_ports [s0, s1]; connect A, then B  ->  A s0, B s1
 *   then delete A, connect C                      ->  C s0 (B keeps s1)
 *
 * Couplings record the chosen indices as sourceSlot / targetSlot; read them
 * through slotOf, which also finds the slots of couplings saved before these
 * existed.
 *
 * A slot is held as source and as target apart, as a general port can be
 * either: one edge leaving through a general slot leaves it free for one edge
 * arriving.
 *
 * circulatory_autogen also takes the first free slot as it connects the module
 * array's rows in order (export orders them to match, see
 * services/export/caOrder.js), but the rules differ: CA groups a module's exit
 * (or entrance) and general ports of one label together, gives a heart's
 * entrance vessel_ports by place in its inp_vessels, and wires a non-vessel_port
 * to every free slot. Where no order matches, the export gives the coupled
 * slots labels of their own (services/export/caPairing.js).
 *
 * Non-multiport constraint
 * ------------------------
 * A port with multiport === 'None' (Python None serialised as a string,
 * used as the default in buildPorts when multi_port is absent) may only
 * participate in ONE conduit edge as source and ONE as target across the
 * entire graph (only a general port can be both). Any other truthy
 * value for multiport means the port is unrestricted.
 */

/** portTypes that may appear on the source (outgoing) side of a coupling. */
const SOURCE_COMPATIBLE_TYPES = new Set(['exit_ports', 'general_ports'])

/** Valid target portTypes for each source portType. */
const TARGET_COMPATIBLE_TYPES = {
  exit_ports: new Set(['entrance_ports', 'general_ports']),
  general_ports: new Set(['entrance_ports', 'exit_ports', 'general_ports']),
}

/**
 * Generates a unique edge ID.
 *
 * @returns {string} Unique edge ID.
 */
export function getId(edgeIds, prefix = 'edge_') {
  // Find the highest existing ID
  let maxId = -1
  edgeIds.forEach((edgeId) => {
    if (edgeId.startsWith(prefix)) {
      const numPart = parseInt(edgeId.split('_')[1], 10)
      if (!isNaN(numPart) && numPart > maxId) {
        maxId = numPart
      }
    }
  })

  // Return the next ID in the sequence
  return `${prefix}${maxId + 1}`
}

/**
 * Returns true when a portLabel entry is single-connection (non-multiport).
 *
 * buildPorts sets multiportType to `p.multi_port ?? 'None'`, so:
 *   'None'               → single-connection (Python None serialised as string)
 *   null / undefined / false → single-connection (absent or falsy)
 *   any other truthy value   → multiport (unrestricted)
 */
export function isSingleConnection(port) {
  const mp = port.multiportType
  return !mp || mp === 'None'
}

/**
 * Gets the slot a coupling's port is in: its index in its (portType, label) group. A recorded slot holds while the
 * port there still matches; otherwise the port is found by identity and then by variables, as for a coupling saved
 * before slots were recorded or whose node's ports have changed since.
 *
 * @param {Array|null} ports - The node's ports.
 * @param {Object} port - The coupling's port on that node.
 * @param {number} [slot] - The coupling's recorded sourceSlot or targetSlot.
 * @returns {number} The port's index in its group; failing that, the recorded slot, or -1 when none is recorded.
 */
export function slotOf(ports, port, slot) {
  return findSlot(ports, port, slot).slot
}

/**
 * Resolves the port-label couplings for ONE conduit edge.
 *
 * For each compatible (source portType, target portType, label) pair of groups, each side takes its group's first slot
 * that is multiport or not in usedPortKeys, though a slot the edge's stored couplings name comes first while it is
 * free. When every slot is held it takes the first, which checkAndClaimCouplings then rejects. Without usedPortKeys,
 * each group's first slot is taken.
 *
 * @param {Array} sourcePorts - node.data.ports of the source node.
 * @param {Array} targetPorts - node.data.ports of the target node.
 * @param {Object} [options]
 * @param {string} [options.sourceId] - The source node's id, as in usedPortKeys.
 * @param {string} [options.targetId] - The target node's id.
 * @param {Set<string>} [options.usedPortKeys] - Slots other edges hold (see buildUsedPortKeys); not changed.
 * @param {Array} [options.stored] - The edge's current couplings, whose slots it keeps while they are free.
 * @returns {Array<{ sourcePort: Object, targetPort: Object, sourceSlot: number, targetSlot: number }>}
 */
export function resolvePortCouplings(
  sourcePorts,
  targetPorts,
  { sourceId, targetId, usedPortKeys = new Set(), stored = [] } = {}
) {
  const couplings = []
  const storedSlot = (side, ports, portType, label) => {
    const coupling = stored.find((c) => c[`${side}Port`]?.portType === portType && c[`${side}Port`]?.label === label)
    return coupling ? slotOf(ports, coupling[`${side}Port`], coupling[`${side}Slot`]) : -1
  }
  // One slot per group, however many groups on the other side it couples to.
  const targetSlots = new Map()

  for (const [groupKey, srcSlots] of groupByTypeAndLabel(sourcePorts, SOURCE_COMPATIBLE_TYPES)) {
    const [srcPortType, label] = groupKey.split('\x00')
    const targetGroups = groupByTypeAndLabel(targetPorts, TARGET_COMPATIBLE_TYPES[srcPortType])
    let sourceSlot = null

    for (const [tgtGroupKey, tgtSlots] of targetGroups) {
      const [tgtPortType, tgtLabel] = tgtGroupKey.split('\x00')
      if (tgtLabel !== label) continue

      sourceSlot ??= pickSlot(sourceId, 'out', srcSlots, usedPortKeys, storedSlot('source', sourcePorts, srcPortType, label))
      if (!targetSlots.has(tgtGroupKey)) {
        const preferred = storedSlot('target', targetPorts, tgtPortType, label)
        targetSlots.set(tgtGroupKey, pickSlot(targetId, 'in', tgtSlots, usedPortKeys, preferred))
      }
      const targetSlot = targetSlots.get(tgtGroupKey)
      couplings.push({ sourcePort: srcSlots[sourceSlot], targetPort: tgtSlots[targetSlot], sourceSlot, targetSlot })
    }
  }

  return couplings
}

/**
 * Resolves the couplings of some edges against the slots every other edge holds. Each keeps the slots its stored
 * couplings name while they are free, so no edge takes a slot another holds; the rest take the first free slot, in
 * edge order. A coupling with no free slot is left out. Pure: neither the edges nor the nodes are changed.
 *
 * @param {Array} nodes - Workspace nodes.
 * @param {Array} edges - Workspace edges.
 * @param {Function} shouldResolve - (edge) => whether to resolve that edge.
 * @param {Object} [options]
 * @param {Map<string, Array>} [options.ports] - Ports to use in place of a node's own, by node id.
 * @param {Array<string>} [options.conflicts] - Collects a message for each coupling left out.
 * @returns {Map<string, Array>} Each resolved edge's id to its couplings; an edge whose node is missing is left out.
 */
export function resolveEdgeCouplings(nodes, edges, shouldResolve, { ports = new Map(), conflicts = [] } = {}) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const portsOf = (id) => ports.get(id) ?? (nodeById.has(id) ? nodeById.get(id).data?.ports ?? [] : null)
  const nameOf = (id) => nodeById.get(id)?.data?.name ?? id

  const resolving = edges.filter((edge) => shouldResolve(edge) && portsOf(edge.source) && portsOf(edge.target))
  const held = buildUsedPortKeys(edges.filter((edge) => !resolving.includes(edge)), portsOf)
  // The slots each resolving edge holds now, kept from the edges resolved before it. A slot held only by its recorded
  // index, its port gone, gives way to an edge whose port is still found there.
  const ends = new Map(resolving.map((edge) => [edge.id, heldEnds(edge, portsOf)]))
  const found = new Set([...ends.values()].flat().filter((end) => end.found).map((end) => end.key))
  const reserved = new Map(
    [...ends].map(([id, list]) => [id, new Set(list.filter((end) => end.found || !found.has(end.key)).map((end) => end.key))])
  )

  const couplings = new Map()
  for (const edge of resolving) {
    reserved.delete(edge.id)
    const used = new Set([held, ...reserved.values()].flatMap((keys) => [...keys]))
    const resolved = resolvePortCouplings(portsOf(edge.source), portsOf(edge.target), {
      sourceId: edge.source,
      targetId: edge.target,
      usedPortKeys: used,
      stored: edge.data?.couplings ?? [],
    })
    const messages = new Set()
    const kept = resolved.filter((coupling) => {
      const taken = takenEnds(edge.source, edge.target, coupling, used, nameOf)
      taken.forEach((message) => messages.add(`${nameOf(edge.source)} → ${nameOf(edge.target)}: ${message}`))
      return !taken.length
    })
    conflicts.push(...messages)
    checkAndClaimCouplings(edge.source, edge.target, kept, held)
    couplings.set(edge.id, kept)
  }
  return couplings
}

/**
 * Recomputes the couplings of every edge touching a node, as they would be with the given ports for that node (see
 * resolveEdgeCouplings). Pure: neither the edges nor the nodes are changed.
 *
 * @param {string} nodeId
 * @param {Array} ports - The node's ports.
 * @param {Array} nodes - Workspace nodes, for the other end's ports.
 * @param {Array} edges - Workspace edges.
 * @param {Array<string>} [conflicts] - Collects a message for each coupling left out as no slot is free.
 * @returns {Map<string, Array>} Each touching edge's id to its couplings; an edge whose other node is missing is left out.
 */
export function previewCouplings(nodeId, ports, nodes, edges, conflicts = []) {
  const touches = (edge) => edge.source === nodeId || edge.target === nodeId
  return resolveEdgeCouplings(nodes, edges, touches, { ports: new Map([[nodeId, ports]]), conflicts })
}

/**
 * Checks whether adding a new conduit (with the given resolved couplings) would
 * violate the non-multiport single-connection constraint, and if not, marks those
 * port slots as consumed.
 *
 * The constraint is per slot on a specific node: once a single-connection slot on
 * node A is coupled via any edge, no further edge may also couple it on the
 * same side (source or target). As
 * resolvePortCouplings takes the first free slot, a conflict means the group has
 * no free slot.
 *
 * All-or-nothing: either all couplings are free (success, usedPortKeys updated)
 * or at least one is already consumed (failure, usedPortKeys NOT modified).
 *
 * @param {string} sourceNodeId
 * @param {string} targetNodeId
 * @param {Array}  couplings     output of resolvePortCouplings()
 * @param {Set}    usedPortKeys  mutable Set, updated in-place on success
 * @param {Function} [nameOf]    node id to the name conflicts give
 * @returns {{ valid: boolean, conflicts: Array<string> }}
 */
export function checkAndClaimCouplings(sourceNodeId, targetNodeId, couplings, usedPortKeys, nameOf = (id) => id) {
  const conflicts = [
    ...new Set(couplings.flatMap((coupling) => takenEnds(sourceNodeId, targetNodeId, coupling, usedPortKeys, nameOf))),
  ]
  if (conflicts.length === 0) {
    couplings.forEach((coupling) =>
      singleEnds(sourceNodeId, targetNodeId, coupling).forEach(({ key }) => usedPortKeys.add(key))
    )
  }
  return { valid: conflicts.length === 0, conflicts }
}

/**
 * Builds the Set of already-consumed single-connection slot keys from the
 * existing edges in the graph. Call this before validating a new connection.
 *
 * @param {Array} edges  VueFlow edges array (each must have edge.data.couplings)
 * @param {Function} [portsOf]  node id to its ports, to find the slots of couplings saved without them (see slotOf)
 * @returns {Set<string>}
 */
export function buildUsedPortKeys(edges, portsOf = () => []) {
  return new Set(edges.flatMap((edge) => heldEnds(edge, portsOf).map((end) => end.key)))
}

// --- Internal helpers --------------------------------------------------------

/**
 * Finds the slot a coupling's port is in (see slotOf), and whether the port was found there rather than the slot
 * taken from its recorded index.
 *
 * @param {Array|null} ports
 * @param {Object} port
 * @param {number} [slot]
 * @returns {{ slot: number, found: boolean }}
 */
function findSlot(ports, port, slot) {
  const group = (ports ?? []).filter((p) => p.portType === port?.portType && p.label === port?.label)
  const variables = JSON.stringify(port?.variables ?? [])
  const matches = (p) => !!p && (p === port || JSON.stringify(p.variables ?? []) === variables)
  const isRecorded = Number.isInteger(slot) && slot >= 0
  if (isRecorded && matches(group[slot])) return { slot, found: true }
  const index = group.indexOf(port) !== -1 ? group.indexOf(port) : group.findIndex(matches)
  return index !== -1 || !isRecorded ? { slot: index, found: index !== -1 } : { slot, found: false }
}

/**
 * Lists the single-connection slots an edge's stored couplings hold.
 *
 * @param {Object} edge
 * @param {Function} portsOf - node id to its ports.
 * @returns {Array<{ key: string, found: boolean }>} found: whether the port is still in that slot (see findSlot).
 */
function heldEnds(edge, portsOf) {
  return (edge.data?.couplings ?? []).flatMap(({ sourcePort, targetPort, sourceSlot, targetSlot }) =>
    [
      [edge.source, 'out', sourcePort, sourceSlot],
      [edge.target, 'in', targetPort, targetSlot],
    ]
      .filter(([, , port]) => isSingleConnection(port))
      .map(([nodeId, role, port, recorded]) => {
        const { slot, found } = findSlot(portsOf(nodeId), port, recorded)
        return { key: portKey(nodeId, role, port, slot), found }
      })
  )
}

/**
 * Groups portLabel entries by a composite key of `portType\x00label`, but only
 * for portTypes that are in the allowedTypes set. Preserves config-file order
 * within each group (which defines slot indices).
 *
 * @param {Array}  portLabels
 * @param {Set}    allowedTypes
 * @returns {Map<string, Array>}  key: "portType\x00label", value: ordered array of portLabel entries
 */
function groupByTypeAndLabel(portLabels, allowedTypes) {
  const groups = new Map()
  for (const pl of portLabels) {
    if (!allowedTypes.has(pl.portType)) continue
    const key = `${pl.portType}\x00${pl.label}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(pl)
  }
  return groups
}

/**
 * Picks a group's slot: the preferred one while it is free, else the first free one, else the first.
 *
 * @param {string} nodeId
 * @param {string} role - 'out' for the edge's source end, 'in' for its target end.
 * @param {Array} slots - The group's ports, in order.
 * @param {Set<string>} usedPortKeys
 * @param {number} preferred - A slot index, or -1 for none.
 * @returns {number}
 */
function pickSlot(nodeId, role, slots, usedPortKeys, preferred) {
  const isFree = (index) => !isSingleConnection(slots[index]) || !usedPortKeys.has(portKey(nodeId, role, slots[index], index))
  if (preferred >= 0 && preferred < slots.length && isFree(preferred)) return preferred
  return Math.max(slots.findIndex((_, index) => isFree(index)), 0)
}

/**
 * Lists a coupling's single-connection ends, with their slot keys.
 *
 * @param {string} sourceNodeId
 * @param {string} targetNodeId
 * @param {Object} coupling
 * @returns {Array<{ nodeId: string, port: Object, key: string }>}
 */
function singleEnds(sourceNodeId, targetNodeId, { sourcePort, targetPort, sourceSlot = 0, targetSlot = 0 }) {
  return [
    [sourceNodeId, 'out', sourcePort, sourceSlot],
    [targetNodeId, 'in', targetPort, targetSlot],
  ]
    .filter(([, , port]) => isSingleConnection(port))
    .map(([nodeId, role, port, slot]) => ({ nodeId, port, key: portKey(nodeId, role, port, slot) }))
}

/**
 * Describes each single-connection end of a coupling whose slot is already held.
 *
 * @param {string} sourceNodeId
 * @param {string} targetNodeId
 * @param {Object} coupling
 * @param {Set<string>} usedPortKeys
 * @param {Function} nameOf - Node id to the name to give.
 * @returns {Array<string>}
 */
function takenEnds(sourceNodeId, targetNodeId, coupling, usedPortKeys, nameOf) {
  return singleEnds(sourceNodeId, targetNodeId, coupling)
    .filter(({ key }) => usedPortKeys.has(key))
    .map(
      ({ nodeId, port }) =>
        `"${nameOf(nodeId)}" has no free "${port.label}" slot (${port.portType}): each takes one connection, and all are taken.`
    )
}

/**
 * Canonical key identifying one slot on one node, as the source ('out') or target ('in') end of an edge.
 *
 * Format: "{nodeId}:{role}:{portType}:{label}:{slot}", where slot is the index of the
 * port within its (portType, label) group.
 */
function portKey(nodeId, role, port, slot) {
  return `${nodeId}:${role}:${port.portType}:${port.label}:${slot}`
}
