/**
 * Orders a CA module array so CA wires it as PhLynx does. CA connects the rows in order, each row's out_instances in
 * order, and gives each connection the first free slot of each repeated port (see utils/edges.js), so the order of
 * rows and of out_instances decides which slot each connection takes. Which port kinds pair, and CA wiring a
 * non-vessel_port to every free slot, follow PhLynx's rules here, not CA's.
 */
import { parseModuleRef } from '../../utils/config'
import { checkAndClaimCouplings, resolvePortCouplings, slotOf } from '../../utils/edges'
import { caHeartInputs, HEART_PORT, heartSlotPin, isHeart } from '../caRules'

/**
 * Orders the rows, and each row's out_instances and inp_instances, so CA reproduces the slots the edges' couplings
 * hold. A row comes before another whose connection holds a later slot of a port they both connect to, and an
 * out_instance before one holding a later slot of the row's own port; inp_instances follow their slots too. A heart's
 * vessel_port inputs come first, in slot order, as CA gives its ivc, svc and pulmonary slots by place in its
 * inp_vessels (two inputs being svc and pulmonary). Otherwise the workspace order is kept.
 *
 * @param {Array} nodes - Workspace nodes.
 * @param {Array} edges - Workspace edges.
 * @returns {{ rows: Array, outEdges: Map<string, Array>, inpEdges: Map<string, Array>, unmatched: Array,
 *   hearts: Set<string> }} rows: the nodes in order; outEdges and inpEdges: each node's edges in list order; unmatched:
 *   the edges CA still couples differently, such as a pairing made by hand that no order gives; hearts: the heart
 *   nodes' ids.
 */
export function orderForCa(nodes, edges) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const portsOf = (id) => nodeById.get(id).data.ports ?? []
  const heartNodes = nodes.filter((node) => isHeart(parseModuleRef(node.data.moduleRef ?? '').moduleType))
  const hearts = new Set(heartNodes.map((node) => node.id))
  const isHeartNode = (id) => hearts.has(id)
  const conduits = edges.filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target))

  // Each edge's slot in each group it couples, on each side, as `portType\x00label` to index.
  const slots = new Map(
    conduits.map((edge) => {
      const source = new Map()
      const target = new Map()
      for (const { sourcePort, targetPort, sourceSlot, targetSlot } of edge.data?.couplings ?? []) {
        source.set(groupKey(sourcePort), slotOf(portsOf(edge.source), sourcePort, sourceSlot))
        if (isHeartNode(edge.target) && isHeartPort(targetPort)) continue
        target.set(groupKey(targetPort), slotOf(portsOf(edge.target), targetPort, targetSlot))
      }
      return [edge, { source, target }]
    })
  )
  const edgesAt = (key, id) => conduits.filter((edge) => edge[key] === id)

  const targetPairs = nodes.flatMap((node) => slotPairs(edgesAt('target', node.id), (edge) => slots.get(edge).target))
  const rows = orderAfter(
    nodes,
    targetPairs.map(([a, b]) => [nodeById.get(a.source), nodeById.get(b.source)])
  )
  const rowIndex = new Map(rows.map((node, index) => [node.id, index]))

  const outEdges = new Map(
    rows.map((node) => {
      const out = edgesAt('source', node.id)
      return [node.id, orderAfter(out, slotPairs(out, (edge) => slots.get(edge).source))]
    })
  )
  const inpEdges = new Map(
    rows.map((node) => {
      const inp = edgesAt('target', node.id).sort((a, b) => rowIndex.get(a.source) - rowIndex.get(b.source))
      if (!isHeartNode(node.id)) return [node.id, orderAfter(inp, slotPairs(inp, (edge) => slots.get(edge).target))]
      const venous = inp.filter((edge) => edge.data?.couplings?.some(({ targetPort }) => isHeartPort(targetPort)))
      const others = inp.filter((edge) => !venous.includes(edge))
      const slotsOf = (edge) => slotsWithHeartPort(edge, portsOf)
      const venousOrder = orderAfter(venous, slotPairs(venous, slotsOf))
      return [node.id, [...venousOrder, ...orderAfter(others, slotPairs(others, slotsOf))]]
    })
  )

  const unmatched = unmatchedEdges(rows, outEdges, inpEdges, portsOf, isHeartNode)
  return { rows, outEdges, inpEdges, unmatched, hearts }
}

/**
 * Connects the edges as CA does, in row and out_instances order, a heart's inputs taking the slots of their place in
 * its inp_instances, and lists the edges whose couplings come out differently from their own.
 *
 * @param {Array} rows
 * @param {Map<string, Array>} outEdges
 * @param {Map<string, Array>} inpEdges
 * @param {Function} portsOf
 * @param {Function} isHeartNode
 * @returns {Array}
 */
function unmatchedEdges(rows, outEdges, inpEdges, portsOf, isHeartNode) {
  const usedPortKeys = new Set()
  const unmatched = []
  const describe = (edge, couplings) =>
    couplings
      .map(({ sourcePort, targetPort, sourceSlot, targetSlot }) => {
        const source = slotOf(portsOf(edge.source), sourcePort, sourceSlot)
        const target = slotOf(portsOf(edge.target), targetPort, targetSlot)
        return `${groupKey(sourcePort)}:${source}>${groupKey(targetPort)}:${target}`
      })
      .sort()
      .join('\n')
  const heartPin = (edge) => {
    if (!isHeartNode(edge.target)) return []
    const inputs = caHeartInputs(inpEdges.get(edge.target).map((inp) => inp.source), outEdges.get(edge.target).length)
    return heartSlotPin(portsOf(edge.target), inputs, edge.source)
  }

  for (const node of rows) {
    for (const edge of outEdges.get(node.id)) {
      const options = { sourceId: edge.source, targetId: edge.target, usedPortKeys, stored: heartPin(edge) }
      const couplings = resolvePortCouplings(portsOf(edge.source), portsOf(edge.target), options)
      const { valid } = checkAndClaimCouplings(edge.source, edge.target, couplings, usedPortKeys)
      if (!valid || describe(edge, couplings) !== describe(edge, edge.data?.couplings ?? [])) unmatched.push(edge)
    }
  }
  return unmatched
}

/**
 * Gets an edge's slot in each target group, heart vessel_port included.
 *
 * @param {Object} edge
 * @param {Function} portsOf
 * @returns {Map<string, number>}
 */
function slotsWithHeartPort(edge, portsOf) {
  return new Map(
    (edge.data?.couplings ?? []).map(({ targetPort, targetSlot }) => [
      groupKey(targetPort),
      slotOf(portsOf(edge.target), targetPort, targetSlot),
    ])
  )
}

/**
 * Lists the pairs [a, b] where a holds an earlier slot than b in a group both hold, so a must come first.
 *
 * @param {Array} items
 * @param {Function} slotsOf - item to its Map of group to slot.
 * @returns {Array<Array>}
 */
function slotPairs(items, slotsOf) {
  return items.flatMap((a) =>
    items.flatMap((b) => {
      const later = [...slotsOf(a)].some(([group, slot]) => slot < (slotsOf(b).get(group) ?? -1))
      return a !== b && later ? [[a, b]] : []
    })
  )
}

/**
 * Orders items so each pair's first comes before its second, otherwise keeping their order. Pairs that contradict
 * each other are broken in that order.
 *
 * @param {Array} items
 * @param {Array<Array>} pairs - [before, after] pairs.
 * @returns {Array}
 */
function orderAfter(items, pairs) {
  const befores = new Map(items.map((item) => [item, []]))
  pairs.forEach(([before, after]) => befores.get(after)?.push(before))
  const remaining = new Set(items)
  const ordered = []
  while (remaining.size) {
    const isReady = (item) => !befores.get(item).some((before) => before !== item && remaining.has(before))
    const next = [...remaining].find(isReady) ?? remaining.values().next().value
    ordered.push(next)
    remaining.delete(next)
  }
  return ordered
}

/**
 * Whether a port is a heart's entrance vessel_port, whose slots CA gives by place in the heart's inp_vessels.
 *
 * @param {Object} port
 * @returns {boolean}
 */
function isHeartPort(port) {
  return port?.portType === 'entrance_ports' && port.label === HEART_PORT
}

/**
 * Keys a port's (portType, label) group.
 *
 * @param {Object} port
 * @returns {string}
 */
function groupKey(port) {
  return `${port.portType}\x00${port.label}`
}
