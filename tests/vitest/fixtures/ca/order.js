/**
 * Orders a workspace's module array as the CA export does, and lists the edges CA would still pair otherwise.
 */
import { couplingPairs, orderCaLists } from '../../../../src/services/export/caOrder.js'
import { comparePairs, simulateCaPairing } from '../../../../src/services/export/caSimulate.js'

/**
 * Orders the rows and lists with each node's own ports, and checks them with CA's simulated pairing.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @returns {{ rows: Array, outEdges: Map<string, Array>, inpEdges: Map<string, Array>, unmatched: Array }} unmatched:
 *   the edges CA still pairs differently, or stops on, in row order.
 */
export function orderForCa(nodes, edges) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const portsOf = (id) => nodeById.get(id)?.data?.ports ?? []
  const wanted = couplingPairs(nodes, edges).pairs
  const lists = orderCaLists(nodes, edges, { portsOf, pairs: wanted })

  const { pairs, errors, ruled } = simulateCaPairing({ ...lists, portsOf })
  const { missing, spurious } = comparePairs(wanted, pairs, { ruled, portsOf })
  const differing = new Set([...missing, ...spurious, ...errors.filter((error) => error.kind !== 'misaligned')].map(({ edge }) => edge))
  const unmatched = lists.rows.flatMap((node) => lists.outEdges.get(node.id)).filter((edge) => differing.has(edge))
  return { ...lists, unmatched }
}
