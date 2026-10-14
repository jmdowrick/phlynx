import { describe, expect, it } from 'vitest'

import { orderForCa } from '../../fixtures/ca/order.js'

const vesselPort = (portType, variable) => ({ label: 'vessel_port', portType, variables: [variable], multiportType: 'None' })
const node = (id, ports, moduleRef = 'vessel:v') => ({ id, data: { name: id, moduleRef, ports } })
const entrances = (count) => Array.from({ length: count }, (_, slot) => vesselPort('entrance_ports', `v${slot}`))
const feeder = (id) => node(id, [vesselPort('exit_ports', 'v')])

/**
 * Makes an edge whose one coupling holds the given slots.
 *
 * @param {Object} source
 * @param {Object} target
 * @param {number} sourceSlot
 * @param {number} targetSlot
 * @returns {Object}
 */
function conduit(source, target, sourceSlot, targetSlot) {
  const sourcePort = source.data.ports.filter((p) => p.portType === 'exit_ports')[sourceSlot]
  const targetPort = target.data.ports.filter((p) => p.portType === 'entrance_ports')[targetSlot]
  return {
    id: `${source.id}--${target.id}`,
    source: source.id,
    target: target.id,
    data: { couplings: [{ sourcePort, targetPort, sourceSlot, targetSlot }] },
  }
}

/**
 * Lists the order orderForCa gives, by node id.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @returns {{ rows: Array<string>, out: Object, inp: Object, unmatched: Array<string> }}
 */
function order(nodes, edges) {
  const { rows, outEdges, inpEdges, unmatched } = orderForCa(nodes, edges)
  const ids = (lists, end) => Object.fromEntries([...lists].map(([id, list]) => [id, list.map((edge) => edge[end])]))
  return {
    rows: rows.map((row) => row.id),
    out: ids(outEdges, 'target'),
    inp: ids(inpEdges, 'source'),
    unmatched: unmatched.map((edge) => edge.id),
  }
}

describe('orderCaLists', () => {
  it('gives the same lists whatever the edge order, where the slots decide it', () => {
    const split = node('s', [vesselPort('exit_ports', 'a'), vesselPort('exit_ports', 'b')])
    const [b, c] = [node('b', entrances(1)), node('c', entrances(1))]
    const edges = [conduit(split, b, 1, 0), conduit(split, c, 0, 0)]

    const forwards = order([split, b, c], edges)
    expect(forwards.out.s).toEqual(['c', 'b'])
    expect(forwards.unmatched).toEqual([])
    expect(order([split, b, c], [...edges].reverse())).toEqual(forwards)
  })

  it("orders a heart's inp_instances by its entrance slots, which CA reads by place, and leaves its rows be", () => {
    const heart = node('h', entrances(3), 'heart:simple')
    const [x, y, z] = ['x', 'y', 'z'].map(feeder)
    const edges = [conduit(x, heart, 0, 1), conduit(y, heart, 0, 2), conduit(z, heart, 0, 0)]

    const { rows, inp, unmatched } = order([heart, x, y, z], edges)
    expect(inp.h).toEqual(['z', 'x', 'y'])
    expect(rows).toEqual(['h', 'x', 'y', 'z'])
    expect(unmatched).toEqual([])
  })

  it('lists the edges no row order gives their slots', () => {
    const [j1, j2] = [node('j1', entrances(2)), node('j2', entrances(2))]
    const [x, y] = [feeder('x'), feeder('y')].map((f) => ({ ...f, data: { ...f.data, ports: [...f.data.ports, vesselPort('exit_ports', 'w')] } }))
    const edges = [conduit(x, j1, 0, 0), conduit(y, j1, 0, 1), conduit(x, j2, 1, 1), conduit(y, j2, 1, 0)]

    expect(order([j1, j2, x, y], edges).unmatched).not.toEqual([])
  })

  it('lists an edge left on a later slot when the edge on an earlier one was deleted', () => {
    const split = node('s', [vesselPort('exit_ports', 'a'), vesselPort('exit_ports', 'b')])
    const b = node('b', entrances(1))

    expect(order([split, b], [conduit(split, b, 1, 0)]).unmatched).toEqual(['s--b'])
  })

  it('lists an edge that holds a single-connection slot another edge holds too', () => {
    const split = node('s', [vesselPort('exit_ports', 'a')])
    const [b, c] = [node('b', entrances(1)), node('c', entrances(1))]

    expect(order([split, b, c], [conduit(split, b, 0, 0), conduit(split, c, 0, 0)]).unmatched).toEqual(['s--c'])
  })
})
