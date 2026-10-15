import { describe, expect, it } from 'vitest'

import {
  exposablePorts,
  exposedPortsOf,
  exposedSlotKeys,
  isBrokenEdge,
  materialiseSubsystems,
  nextExposedPortId,
  planExposure,
  planOverrideRemoval,
  planRelabel,
  planReorder,
  planUnexpose,
  subsystemPorts,
} from '../../../../src/services/hierarchy/exposure.js'
import { expandHierarchy } from '../../../../src/services/hierarchy/expand.js'
import { EXPOSURE_EDGE_TYPE } from '../../../../src/utils/constants.js'
import { buildUsedPortKeys, slotOf } from '../../../../src/utils/edges.js'
import { findPort } from '../../../../src/utils/ports.js'
import { connect, exposed, exposures, module, port, subsystem, supermodule } from '../../fixtures/hierarchy/graph.js'

const IN = port('entrance_ports', 'vessel', ['v_in'])
const OUT = port('exit_ports', 'vessel', ['v'])
const vessel = (localId, name, options = {}) => module(localId, name, { ports: [{ ...IN }, { ...OUT }], ...options })

/**
 * Root src → p1 → sink and an unconnected p2, both subsystems of pair (sm_1: a → b), exposing a's entrance (xp_in)
 * and b's exit (xp_out).
 */
function pairGraph() {
  const a = vessel('a', 'a', { scope: 'sm_1' })
  const b = vessel('b', 'b', { scope: 'sm_1' })
  const sm = supermodule('sm_1', 'pair', { submoduleOrder: ['a', 'b'] })
  const exposure = exposures('sm_1', [exposed('xp_in', 'a', 'entrance_ports', 'vessel'), exposed('xp_out', 'b', 'exit_ports', 'vessel')])
  const inner = { nodes: [sm, a, b], edges: exposure }
  const p1 = subsystem(inner, 'dndnode_1', 'p1', 'sm_1')
  const p2 = subsystem(inner, 'dndnode_3', 'p2', 'sm_1')
  const src = vessel('dndnode_0', 'src')
  const sink = vessel('dndnode_2', 'sink')
  const used = new Set()
  const edges = [connect(src, p1, { used, id: 'e0' }), connect(p1, sink, { used, id: 'e1' }), connect(a, b, { id: 'e_int' }), ...exposure]
  return { nodes: [src, p1, sink, p2, sm, a, b], edges }
}

const edgeOf = (edges, id) => edges.find((edge) => edge.id === id)
const withEntries = (edges, id, exposed) => edges.map((edge) => (edge.id === id ? { ...edge, data: { exposed } } : edge))

describe('exposed ports, read from exposure edges', () => {
  it('lists a super-module’s exposed ports in their order, the child each is on, and the edge', () => {
    const { nodes, edges } = pairGraph()
    expect(exposedPortsOf('sm_1', nodes, edges)).toEqual([
      { id: 'xp_in', alias: { child: 'a', portType: 'entrance_ports', label: 'vessel', slot: 0 }, order: 0, edgeId: 'sm_1~a--sm_1', childId: 'sm_1~a' },
      { id: 'xp_out', alias: { child: 'b', portType: 'exit_ports', label: 'vessel', slot: 0 }, order: 1, edgeId: 'sm_1~b--sm_1', childId: 'sm_1~b' },
    ])
  })

  it('reads an edge drawn either way round, and none that isn’t a child’s to its own interface', () => {
    const { nodes, edges } = pairGraph()
    const flipped = edges.map((edge) => (edge.id === 'sm_1~a--sm_1' ? { ...edge, source: 'sm_1', target: 'sm_1~a' } : edge))
    expect(exposedPortsOf('sm_1', nodes, flipped).map((p) => p.id)).toEqual(['xp_in', 'xp_out'])
    const stray = { id: 'x', type: EXPOSURE_EDGE_TYPE, source: 'dndnode_0', target: 'sm_1', data: { exposed: [{ id: 'xp_9', alias: { portType: 'exit_ports', label: 'vessel', slot: 0 } }] } }
    expect(exposedPortsOf('sm_1', nodes, [...edges, stray]).map((p) => p.id)).toEqual(['xp_in', 'xp_out'])
  })

  it('follows order across edges, then edge and entry order', () => {
    const { nodes, edges } = pairGraph()
    edgeOf(edges, 'sm_1~a--sm_1').data.exposed[0].order = 3
    expect(exposedPortsOf('sm_1', nodes, edges).map((p) => p.id)).toEqual(['xp_out', 'xp_in'])
    expect(subsystemPorts(nodes, edges, 'sm_1').map((p) => p.exposedPortId)).toEqual(['xp_out', 'xp_in'])
  })

  it('never reuses an id a coupling still names', () => {
    const { nodes, edges } = pairGraph()
    expect(nextExposedPortId(nodes, edges)).toBe('xp_0')
    const named = edges.map((edge) => (edge.id === 'e0' ? { ...edge, data: { couplings: [{ targetPort: { exposedPortId: 'xp_7' } }] } } : edge))
    expect(nextExposedPortId(nodes, named)).toBe('xp_8')
  })
})

describe('the Expose Ports dialog', () => {
  it('lists a module’s whole ports, the exposed ones with their ids', () => {
    const { nodes, edges } = pairGraph()
    const rows = exposablePorts(edgeOf(edges, 'sm_1~a--sm_1'), nodes, edges)
    expect(rows.map(({ key, exposedPortId, disabled }) => ({ key, exposedPortId, disabled }))).toEqual([
      { key: 'entrance_ports:vessel#0', exposedPortId: 'xp_in', disabled: false },
      // a's exit takes one connection, and e_int has it.
      { key: 'exit_ports:vessel#0', exposedPortId: null, disabled: true },
    ])
    expect(rows[0].port).toEqual(IN)
    expect(rows[1].reason).toMatch(/already has it/)
  })

  it('refuses a single-connection port a connection inside already has, and a port given twice', () => {
    const { nodes, edges } = pairGraph()
    const edge = edgeOf(edges, 'sm_1~a--sm_1')
    expect(planExposure(edge, [{ key: 'exit_ports:vessel#0' }], nodes, edges).problems).toEqual([expect.stringMatching(/already has it/)])
    expect(planExposure(edge, [{ key: 'entrance_ports:vessel#0' }, { key: 'entrance_ports:vessel#0' }], nodes, edges).problems).toEqual([
      '"vessel" (slot 0) is exposed twice.',
    ])
    expect(planExposure(edge, [{ key: 'nope' }], nodes, edges).problems).toHaveLength(1)
  })

  it('keeps the ids of ports still exposed, gives new ones fresh ids after every exposed port, and says what goes', () => {
    const { nodes, edges } = pairGraph()
    const multi = edges.map((edge) => (edge.id === 'e_int' ? { ...edge, data: { couplings: [] } } : edge))
    const plan = planExposure(edgeOf(multi, 'sm_1~a--sm_1'), [{ key: 'exit_ports:vessel#0', label: 'a_out' }, { key: 'entrance_ports:vessel#0' }], nodes, multi)
    expect(plan.problems).toEqual([])
    expect(plan.entries).toEqual([
      { id: 'xp_0', alias: { portType: 'exit_ports', label: 'vessel', slot: 0 }, label: 'a_out', order: 2 },
      { id: 'xp_in', alias: { portType: 'entrance_ports', label: 'vessel', slot: 0 }, order: 0 },
    ])
    expect(planExposure(edgeOf(edges, 'sm_1~a--sm_1'), [], nodes, edges)).toEqual({ entries: [], removedIds: ['xp_in'], problems: [] })
  })

  it('reorders the edge’s own ports among the places they had', () => {
    const { nodes, edges } = pairGraph()
    const both = withEntries(edges, 'sm_1~a--sm_1', [
      { id: 'xp_in', alias: { portType: 'entrance_ports', label: 'vessel', slot: 0 }, order: 0 },
      { id: 'xp_x', alias: { portType: 'exit_ports', label: 'vessel', slot: 0 }, order: 5 },
    ]).map((edge) => (edge.id === 'e_int' ? { ...edge, data: { couplings: [] } } : edge))
    const plan = planExposure(edgeOf(both, 'sm_1~a--sm_1'), [{ key: 'exit_ports:vessel#0' }, { key: 'entrance_ports:vessel#0' }], nodes, both)
    expect(plan.entries.map(({ id, order }) => [id, order])).toEqual([
      ['xp_x', 0],
      ['xp_in', 5],
    ])
  })

  it('exposes a nested subsystem’s port through via', () => {
    const { nodes, edges } = pairGraph()
    const outer = supermodule('sm_5', 'outer', { submoduleOrder: ['dndnode_0'] })
    const store = { nodes: [...nodes, outer], edges }
    const inner = subsystem(store, 'dndnode_0', 'inner', 'sm_1', { scope: 'sm_5' })
    const edge = { id: `${inner.id}--sm_5`, type: EXPOSURE_EDGE_TYPE, source: inner.id, target: 'sm_5', data: { exposed: [] } }
    const all = { nodes: [...store.nodes, inner], edges: [...edges, edge] }
    const rows = exposablePorts(edge, all.nodes, all.edges)
    expect(rows.map((row) => row.key)).toEqual(['via:xp_in', 'via:xp_out'])
    const plan = planExposure(edge, [{ key: 'via:xp_out', label: 'drain' }], all.nodes, all.edges)
    expect(plan.entries).toEqual([{ id: 'xp_0', alias: { via: 'xp_out' }, label: 'drain', order: 0 }])
    const exposedNow = withEntries(all.edges, edge.id, plan.entries)
    expect(subsystemPorts(all.nodes, exposedNow, 'sm_5')).toEqual([{ ...OUT, label: 'drain', exposedPortId: 'xp_0' }])
  })
})

describe('ordering and labels for the whole super-module', () => {
  it('reorders exposed ports across edges', () => {
    const { nodes, edges } = pairGraph()
    const plan = planReorder('sm_1', ['xp_out', 'xp_in'], nodes, edges)
    expect([...plan.keys()].sort()).toEqual(['sm_1~a--sm_1', 'sm_1~b--sm_1'])
    expect(plan.get('sm_1~a--sm_1')[0].order).toBe(1)
    expect(planReorder('sm_1', ['xp_in', 'xp_out'], nodes, edges).size).toBe(0)
  })

  it('labels an exposed port, and goes back to the child port’s label', () => {
    const { nodes, edges } = pairGraph()
    const labelled = planRelabel('sm_1', 'xp_in', ' venous ', nodes, edges)
    expect(labelled.get('sm_1~a--sm_1')[0].label).toBe('venous')
    const relabelled = withEntries(edges, 'sm_1~a--sm_1', labelled.get('sm_1~a--sm_1'))
    expect(planRelabel('sm_1', 'xp_in', 'vessel', nodes, relabelled).get('sm_1~a--sm_1')[0]).not.toHaveProperty('label')
  })
})

describe('materialiseSubsystems', () => {
  it('changes nothing when every subsystem is in step', () => {
    const { nodes, edges } = pairGraph()
    expect(materialiseSubsystems(nodes, edges)).toEqual({ nodes: new Map(), couplings: new Map() })
  })

  it('rebinds couplings by exposed port id as ports move, keeping their pairing and the other end’s slot', () => {
    const { nodes, edges } = pairGraph()
    // A pairing by hand: src's exit to p1's xp_in, with src's slot pinned at 0.
    const reordered = edges.map((edge) =>
      edge.id === 'sm_1~a--sm_1' ? { ...edge, data: { exposed: [{ ...edge.data.exposed[0], order: 9, label: 'venous' }] } } : edge
    )
    const { nodes: changed, couplings } = materialiseSubsystems(nodes, reordered)
    expect(changed.get('dndnode_1').ports.map((p) => [p.exposedPortId, p.label])).toEqual([
      ['xp_out', 'vessel'],
      ['xp_in', 'venous'],
    ])
    const [coupling] = couplings.get('e0')
    expect(coupling.targetPort).toEqual({ ...IN, label: 'venous', exposedPortId: 'xp_in' })
    expect(coupling.targetSlot).toBe(0)
    expect(coupling.sourcePort).toBe(edgeOf(edges, 'e0').data.couplings[0].sourcePort)
    expect(coupling.sourceSlot).toBe(0)
  })

  it('flags a coupling whose exposed port is gone broken, keeping it, and clears the flag when it comes back', () => {
    const { nodes, edges } = pairGraph()
    const unexposed = edges.filter((edge) => edge.id !== 'sm_1~b--sm_1')
    const { nodes: changed, couplings } = materialiseSubsystems(nodes, unexposed)
    expect(changed.get('dndnode_1')).toEqual({ ports: [{ ...IN, exposedPortId: 'xp_in' }], broken: ['xp_out'] })
    expect(couplings.has('e1')).toBe(false)
    const p1 = { ...nodes[1], data: { ...nodes[1].data, ...changed.get('dndnode_1') } }
    const broken = nodes.map((node) => (node.id === 'dndnode_1' ? p1 : node))
    expect(isBrokenEdge(edgeOf(edges, 'e1'), new Map(broken.map((node) => [node.id, node])))).toBe(true)
    expect(materialiseSubsystems(broken, edges).nodes.get('dndnode_1')).toEqual({ ports: nodes[1].data.ports, broken: undefined })
  })

  it('takes in a child port’s live variables and multiport', () => {
    const { nodes, edges } = pairGraph()
    nodes.find((node) => node.id === 'sm_1~a').data.ports[0].multiportType = ['sum', 'True']
    const { nodes: changed, couplings } = materialiseSubsystems(nodes, edges)
    expect(changed.get('dndnode_1').ports[0].multiportType).toEqual(['sum', 'True'])
    expect(changed.get('dndnode_3').ports[0].multiportType).toEqual(['sum', 'True'])
    expect(couplings.get('e0')[0].targetPort.multiportType).toEqual(['sum', 'True'])
  })
})

describe('planUnexpose', () => {
  it('trims the couplings to the ports un-exposed, removing an edge left with none, and counts what it touches', () => {
    const { nodes, edges } = pairGraph()
    const plan = planUnexpose(nodes, edges, { unexposed: new Map([['sm_1', ['xp_out']]]) })
    expect(plan.removeEdgeIds).toEqual(['e1'])
    expect(plan.couplings.size).toBe(0)
    expect(plan.exposures.get('sm_1~b--sm_1')).toEqual([])
    expect(plan).toMatchObject({ connections: 1, couplingCount: 1, subsystems: ['dndnode_1'], isEmpty: false })
    const after = edges.filter((edge) => !plan.removeEdgeIds.includes(edge.id)).map((edge) => (plan.exposures.has(edge.id) ? { ...edge, data: { exposed: plan.exposures.get(edge.id) } } : edge))
    expect(expandHierarchy(nodes, after).errors).toEqual([])
  })

  it('un-exposes an outer super-module’s port exposing it through via, and trims the connections to that', () => {
    const { nodes, edges } = pairGraph()
    const outer = supermodule('sm_5', 'outer', { submoduleOrder: ['dndnode_0'] })
    const inner = subsystem({ nodes: [...nodes, outer], edges }, 'dndnode_0', 'inner', 'sm_1', { scope: 'sm_5' })
    const outerExposure = { id: `${inner.id}--sm_5`, type: EXPOSURE_EDGE_TYPE, source: inner.id, target: 'sm_5', data: { exposed: [{ id: 'xp_9', alias: { via: 'xp_out' }, order: 0 }] } }
    const store = { nodes: [...nodes, outer, inner], edges: [...edges, outerExposure] }
    const top = subsystem(store, 'dndnode_7', 'top', 'sm_5')
    const host = vessel('dndnode_8', 'host')
    const all = { nodes: [...store.nodes, top, host], edges: [...store.edges, connect(top, host, { id: 'e9' })] }
    const plan = planUnexpose(all.nodes, all.edges, { unexposed: new Map([['sm_1', ['xp_out']]]) })
    expect(plan.exposures.get(outerExposure.id)).toEqual([])
    expect(plan.removeEdgeIds.sort()).toEqual(['e1', 'e9'])
    expect([...plan.unexposed.get('sm_5')]).toEqual(['xp_9'])
    expect(plan.subsystems.sort()).toEqual(['dndnode_1', 'dndnode_7'])
  })

  it('un-exposes a removed child’s ports, and drops the overrides of it, nested ones included', () => {
    const { nodes, edges } = pairGraph()
    nodes[1].data.overrides = { a: { k: { value: '1' } }, b: { k: { value: '2' } } }
    const plan = planUnexpose(nodes, edges, { removedNodeIds: ['sm_1~b'] })
    expect(plan.removeEdgeIds).toEqual(['e1'])
    expect(plan.overrides.get('dndnode_1')).toEqual({ a: { k: { value: '1' } } })
    expect(planOverrideRemoval(nodes, new Set(['sm_1~a'])).get('dndnode_1')).toEqual({ b: { k: { value: '2' } } })
  })

  it('un-exposes an exposure edge’s ports when the edge goes', () => {
    const { nodes, edges } = pairGraph()
    const plan = planUnexpose(nodes, edges, { removedEdgeIds: ['sm_1~a--sm_1'] })
    expect(plan.removeEdgeIds).toEqual(['e0'])
    expect(plan.exposures.size).toBe(0)
  })
})

describe('exposedSlotKeys', () => {
  it('takes the slots of exposed single-connection ports both ways', () => {
    const { nodes, edges } = pairGraph()
    expect([...exposedSlotKeys(nodes, edges, 'sm_1')].sort()).toEqual([
      'sm_1~a:in:entrance_ports:vessel:0',
      'sm_1~a:out:entrance_ports:vessel:0',
      'sm_1~b:in:exit_ports:vessel:0',
      'sm_1~b:out:exit_ports:vessel:0',
    ])
  })
})

describe('connecting to a subsystem', () => {
  /** sub (sm_1) exposing two entrance vessel ports alike, a's then c's, and two hosts. */
  function twinGraph() {
    const a = vessel('a', 'a', { scope: 'sm_1' })
    const c = vessel('c', 'c', { scope: 'sm_1' })
    const sm = supermodule('sm_1', 'twin', { submoduleOrder: ['a', 'c'] })
    const exposure = exposures('sm_1', [exposed('xp_a', 'a', 'entrance_ports', 'vessel'), exposed('xp_c', 'c', 'entrance_ports', 'vessel')])
    const sub = subsystem({ nodes: [sm, a, c], edges: exposure }, 'dndnode_1', 'sub', 'sm_1')
    return { sub, exposure, nodes: [vessel('dndnode_0', 'h0'), vessel('dndnode_2', 'h2'), sub, sm, a, c] }
  }

  it('takes each exposed port’s first free slot, as for a module (#702), and finds each by its exposed port id', () => {
    const { sub, nodes, exposure } = twinGraph()
    const used = new Set()
    const first = connect(nodes[0], sub, { used, id: 'e0' })
    const second = connect(nodes[1], sub, { used, id: 'e1' })
    expect([first, second].map((edge) => [edge.data.couplings[0].targetPort.exposedPortId, edge.data.couplings[0].targetSlot])).toEqual([
      ['xp_a', 0],
      ['xp_c', 1],
    ])
    // Alike in label and variables, told apart by exposed port id, as the connection dialog and slots read them.
    expect(findPort(sub.data.ports, second.data.couplings[0].targetPort)).toBe(sub.data.ports[1])
    expect(slotOf(sub.data.ports, { ...second.data.couplings[0].targetPort }, undefined)).toBe(1)
    expect(buildUsedPortKeys([first, second], () => sub.data.ports).size).toBe(4)
    expect(expandHierarchy(nodes, [first, second, ...exposure]).errors).toEqual([])
  })

  it('keeps a pairing chosen by hand, and the host’s slot, as the exposed ports are reordered', () => {
    const { sub, nodes, exposure } = twinGraph()
    const host = vessel('dndnode_0', 'h0', { ports: [{ ...OUT }, { ...OUT }] })
    // Re-paired by hand: the host's second exit slot to c's port.
    const edge = { id: 'e0', source: host.id, target: sub.id, data: { couplings: [{ sourcePort: host.data.ports[1], sourceSlot: 1, targetPort: sub.data.ports[1], targetSlot: 1 }] } }
    const reordered = exposure.map((e) => (e.source === 'sm_1~c' ? { ...e, data: { exposed: [{ ...e.data.exposed[0], order: -1 }] } } : e))
    const all = [host, ...nodes.slice(1)]
    const { couplings } = materialiseSubsystems(all, [edge, ...reordered])
    expect(couplings.get('e0')).toEqual([{ sourcePort: host.data.ports[1], sourceSlot: 1, targetPort: { ...IN, exposedPortId: 'xp_c' }, targetSlot: 0 }])
  })
})
