import { describe, expect, it } from 'vitest'

import { orderForCa } from '../../fixtures/ca/order.js'
import { expandHierarchy, subsystemPorts } from '../../../../src/services/hierarchy/expand.js'
import { EXPOSURE_EDGE_TYPE } from '../../../../src/utils/constants.js'
import { connect, constant, exposed, module, port, shuffled, subsystem, supermodule } from '../../fixtures/hierarchy/graph.js'

const IN = port('entrance_ports', 'vessel', ['v_in', 'u'])
const OUT = port('exit_ports', 'vessel', ['v', 'u_out'])
const vessel = (localId, name, options = {}) =>
  module(localId, name, { ports: [{ ...IN }, { ...OUT }], variables: [constant('R', '1')], ...options })

/** Root a → heart (sm_1: ra → lv, exposing ra's input and lv's output) → b. */
function heartGraph({ overrides = {}, order = ['ra', 'lv'], naming } = {}) {
  const ra = vessel('ra', 'ra', { scope: 'sm_1' })
  const lv = vessel('lv', 'lv', { scope: 'sm_1' })
  const sm = supermodule('sm_1', 'heart', {
    submoduleOrder: order,
    exposedPorts: [exposed('xp_in', 'ra', 'entrance_ports', 'vessel'), exposed('xp_out', 'lv', 'exit_ports', 'vessel')],
    ...(naming && { naming }),
  })
  const inner = [sm, ra, lv]
  const heart = subsystem(inner, 'dndnode_1', 'heart', 'sm_1', { overrides })
  const a = vessel('dndnode_0', 'a')
  const b = vessel('dndnode_2', 'b')
  const used = new Set()
  const edges = [
    { ...connect(a, heart, { used, id: 'e_in' }), sourceHandle: 'handle_a', targetHandle: 'handle_xp_in' },
    connect(heart, b, { used, id: 'e_out' }),
    connect(ra, lv, { id: 'e_int' }),
  ]
  return { nodes: [a, heart, b, ...inner], edges, ra, lv, a, b, heart }
}

/** Root leg (limb: art, bed) where bed (bedsm: cap) holds cap with k. */
function twoLevel({ outer = {}, inner = {} } = {}) {
  const cap = vessel('cap', 'cap', { scope: 'sm_2', variables: [constant('k', '1'), constant('R', '1')] })
  const bedsm = supermodule('sm_2', 'bedsm', {
    submoduleOrder: ['cap'],
    exposedPorts: [exposed('xp_in', 'cap', 'entrance_ports', 'vessel'), exposed('xp_out', 'cap', 'exit_ports', 'vessel')],
  })
  const art = vessel('art', 'art', { scope: 'sm_1' })
  const limbParts = [bedsm, cap]
  const bed = subsystem(limbParts, 'bed', 'bed', 'sm_2', { scope: 'sm_1', overrides: inner })
  const limb = supermodule('sm_1', 'limb', {
    submoduleOrder: ['art', 'bed'],
    exposedPorts: [exposed('xp_a', 'art', 'entrance_ports', 'vessel'), exposed('xp_b', 'bed', 'exit_ports', 'vessel', { via: 'xp_out' })],
  })
  const store = [limb, art, bed, ...limbParts]
  const leg = subsystem(store, 'dndnode_1', 'leg', 'sm_1', { overrides: outer })
  const aorta = vessel('dndnode_0', 'aorta')
  const vc = vessel('dndnode_2', 'vc')
  const used = new Set()
  const edges = [
    connect(aorta, leg, { used, id: 'e1' }),
    connect(leg, vc, { used, id: 'e2' }),
    connect(art, bed, { id: 'e3' }),
  ]
  return { nodes: [aorta, leg, vc, ...store], edges, cap, art }
}

describe('expandHierarchy on flat models', () => {
  const flat = () => {
    const a = vessel('dndnode_0', 'a')
    const b = vessel('dndnode_1', 'b')
    const c = vessel('dndnode_2', 'c')
    const used = new Set()
    return { nodes: [a, b, c], edges: [connect(a, b, { used }), connect(b, c, { used })] }
  }

  it('gives back the same nodes and edges, in the same order', () => {
    const { nodes, edges } = flat()
    const expansion = expandHierarchy(nodes, edges)
    expect(expansion.nodes).toEqual(nodes)
    expect(expansion.edges).toEqual(edges)
    expansion.nodes.forEach((node, i) => expect(node).toBe(nodes[i]))
    expansion.edges.forEach((edge, i) => expect(edge).toBe(edges[i]))
    expect(expansion.errors).toEqual([])
  })

  it('keeps any order it is given', () => {
    const { nodes, edges } = flat()
    for (const seed of [1, 7, 42]) {
      const [n, e] = [shuffled(nodes, seed), shuffled(edges, seed)]
      const expansion = expandHierarchy(n, e)
      expect(expansion.nodes).toEqual(n)
      expect(expansion.edges).toEqual(e)
    }
  })

  it('keeps nodes saved before scopes existed', () => {
    const { nodes, edges } = flat()
    const legacy = nodes.map(({ data: { scope, localId, ...data }, ...node }) => ({ ...node, data }))
    expect(expandHierarchy(legacy, edges).nodes).toEqual(legacy)
  })

  it('warns of root modules sharing a name, which flat export already tolerates', () => {
    const { nodes, edges } = flat()
    nodes[2].data.name = 'a'
    const errors = expandHierarchy(nodes, edges).errors
    expect(errors.map((error) => [error.kind, error.convention, error.severity])).toEqual([
      ['flatNameClash', undefined, 'warning'],
      ['parameterNameClash', 'cellml', 'warning'],
      ['parameterNameClash', 'ca', 'warning'],
    ])
  })

  it('names, paths and ids by the modules own names', () => {
    const { nodes, edges } = flat()
    const expansion = expandHierarchy(nodes, edges)
    expect(expansion.nameOf('dndnode_1')).toBe('b')
    expect(expansion.pathOf('dndnode_1')).toBe('b')
    expect(expansion.idOf('b')).toBe('dndnode_1')
    expect(expansion.origin.get('dndnode_1')).toEqual({ mainId: 'dndnode_1', instanceChain: [] })
  })
})

describe('expandHierarchy on subsystems', () => {
  it('puts the children in the subsystem’s place, in submoduleOrder, with path ids and prefixed names', () => {
    const { nodes, edges } = heartGraph({ order: ['lv', 'ra'] })
    const expansion = expandHierarchy(nodes, edges)
    expect(expansion.nodes.map((node) => node.id)).toEqual(['dndnode_0', 'dndnode_1/lv', 'dndnode_1/ra', 'dndnode_2'])
    expect(expansion.nodes.map((node) => node.data.name)).toEqual(['a', 'heart__lv', 'heart__ra', 'b'])
    expect(expansion.pathOf('dndnode_1/ra')).toBe('heart/ra')
    expect(expansion.idOf('heart__ra')).toBe('dndnode_1/ra')
    expect(expansion.idOf('heart/ra')).toBe('dndnode_1/ra')
    expect(expansion.origin.get('dndnode_1/ra')).toEqual({ mainId: 'sm_1~ra', instanceChain: ['dndnode_1'] })
    expect(expansion.nodes[1].data).not.toHaveProperty('scope')
    expect(expansion.errors).toEqual([])
  })

  it('leaves a super-module with no subsystem out of the model', () => {
    const { nodes, edges, a, b } = heartGraph()
    const expansion = expandHierarchy(
      nodes.filter((node) => node.id !== 'dndnode_1'),
      edges.filter((edge) => edge.id === 'e_int')
    )
    expect(expansion.nodes).toEqual([a, b])
    expect(expansion.edges).toEqual([])
  })

  it('rewrites couplings to the aliased child’s live port, with its slot, one edge per pair', () => {
    const { nodes, edges, ra, lv } = heartGraph()
    const expansion = expandHierarchy(nodes, edges)
    const byId = new Map(expansion.edges.map((edge) => [edge.id, edge]))
    expect([...byId.keys()].sort()).toEqual(['dndnode_1/e_int', 'e_in#0', 'e_out#0'])
    const into = byId.get('e_in#0')
    expect(into).toMatchObject({ source: 'dndnode_0', target: 'dndnode_1/ra', sourceHandle: 'handle_a' })
    // The subsystem's handle is not the child's.
    expect(into).not.toHaveProperty('targetHandle')
    expect(into.data.couplings[0].targetPort).toBe(ra.data.ports[0])
    expect(into.data.couplings[0].targetSlot).toBe(0)
    expect(byId.get('e_out#0').data.couplings[0].sourcePort).toBe(lv.data.ports[1])
    expect(byId.get('dndnode_1/e_int')).toMatchObject({ source: 'dndnode_1/ra', target: 'dndnode_1/lv' })
    expect(expansion.origin.get('e_in#0')).toEqual({ mainId: 'e_in', instanceChain: [], edgeId: 'e_in' })
  })

  it('reads multiport from the child port as it is now', () => {
    const { nodes, edges, ra } = heartGraph()
    ra.data.ports[0].multiportType = ['sum', 'True']
    const into = expandHierarchy(nodes, edges).edges.find((edge) => edge.id === 'e_in#0')
    expect(into.data.couplings[0].targetPort.multiportType).toEqual(['sum', 'True'])
  })

  it('keeps the children’s own names under preserve naming', () => {
    const { nodes, edges } = heartGraph({ naming: 'preserve' })
    nodes.find((node) => node.id === 'sm_1~ra').data.originalName = 'right_atrium'
    const expansion = expandHierarchy(nodes, edges)
    expect(expansion.nodes.map((node) => node.data.name)).toEqual(['a', 'right_atrium', 'lv', 'b'])
    expect(expansion.pathOf('dndnode_1/ra')).toBe('heart/ra')
    expect(expansion.idOf('right_atrium')).toBe('dndnode_1/ra')
  })

  it('carries the model fields only, so canvas state inside a super-module changes nothing', () => {
    const plain = heartGraph()
    const moved = heartGraph()
    const ra = moved.nodes.find((node) => node.id === 'sm_1~ra')
    Object.assign(ra, { position: { x: 40, y: 9 }, computedPosition: { x: 40, y: 9, z: 0 }, dimensions: { width: 80 }, selected: true })
    const internal = moved.edges.find((edge) => edge.id === 'e_int')
    Object.assign(internal, { selected: true, sourceX: 12, sourceNode: ra, targetHandle: 'handle_lv' })
    Object.assign(moved.edges.find((edge) => edge.id === 'e_in'), { sourceX: 3, targetNode: moved.heart })
    const expansion = expandHierarchy(moved.nodes, moved.edges)
    const handled = expandHierarchy(plain.nodes, plain.edges.map((edge) => (edge.id === 'e_int' ? { ...edge, targetHandle: 'handle_lv' } : edge)))
    expect(expansion.nodes).toEqual(handled.nodes)
    expect(expansion.edges).toEqual(handled.edges)
    expect(Object.keys(expansion.nodes.find((node) => node.id === 'dndnode_1/ra'))).toEqual(['id', 'type', 'data'])
    expect(Object.keys(expansion.edges.find((edge) => edge.id === 'e_in#0')).sort()).toEqual(['data', 'id', 'source', 'sourceHandle', 'target', 'type'])
    expect(expansion.edges.find((edge) => edge.id === 'dndnode_1/e_int').targetHandle).toBe('handle_lv')
  })

  it('reports an edge that joins two scopes, or ends at an interface node, and leaves it out', () => {
    const { nodes, edges, a, ra } = heartGraph()
    const across = { id: 'across', source: a.id, target: ra.id, data: { couplings: [] } }
    const toInterface = { id: 'to_interface', source: ra.id, target: 'sm_1', data: { couplings: [] } }
    const expansion = expandHierarchy(nodes, [...edges, across, toInterface])
    expect(expansion.errors).toEqual([
      expect.objectContaining({ kind: 'crossScopeEdge', severity: 'error', origins: [{ mainId: 'across', instanceChain: [], edgeId: 'across' }] }),
      expect.objectContaining({ kind: 'crossScopeEdge', message: expect.stringContaining('interface node') }),
    ])
    expect(expansion.edges).toEqual(expandHierarchy(nodes, edges).edges)
  })

  it('ignores exposure edges', () => {
    const { nodes, edges } = heartGraph()
    const exposure = { id: 'x1', type: EXPOSURE_EDGE_TYPE, source: 'sm_1~ra', target: 'sm_1', data: { exposedPortId: 'xp_in' } }
    const { nodes: n1, edges: e1, errors } = expandHierarchy(nodes, [...edges, exposure])
    const plain = expandHierarchy(nodes, edges)
    expect({ n1, e1, errors }).toEqual({ n1: plain.nodes, e1: plain.edges, errors: plain.errors })
  })
})

describe('expandHierarchy values', () => {
  const valueOf = (expansion, id, name) => expansion.nodes.find((node) => node.id === id).data.variables.find((row) => row.name === name).value

  it('expands two levels, following via to the grandchild’s port', () => {
    const { nodes, edges, cap } = twoLevel()
    const expansion = expandHierarchy(nodes, edges)
    expect(expansion.nodes.map((node) => node.data.name)).toEqual(['aorta', 'leg__art', 'leg__bed__cap', 'vc'])
    expect(expansion.pathOf('dndnode_1/bed/cap')).toBe('leg/bed/cap')
    const out = expansion.edges.find((edge) => edge.id === 'e2#0')
    expect(out).toMatchObject({ source: 'dndnode_1/bed/cap', target: 'dndnode_2' })
    expect(out.data.couplings[0].sourcePort).toBe(cap.data.ports[1])
    expect(expansion.edges.find((edge) => edge.id === 'dndnode_1/e3#0')).toMatchObject({ source: 'dndnode_1/art', target: 'dndnode_1/bed/cap' })
    expect(expansion.origin.get('dndnode_1/bed/cap')).toEqual({ mainId: 'sm_2~cap', instanceChain: ['dndnode_1', 'sm_1~bed'] })
    expect(expansion.errors).toEqual([])
  })

  it('applies overrides inside out, so the outermost subsystem wins', () => {
    const inner = { cap: { k: { value: '2' } } }
    const outer = { 'bed/cap': { k: { value: '3' } } }
    const capK = ({ nodes, edges }) => valueOf(expandHierarchy(nodes, edges), 'dndnode_1/bed/cap', 'k')
    expect(capK(twoLevel())).toBe('1')
    expect(capK(twoLevel({ inner }))).toBe('2')
    expect(capK(twoLevel({ outer }))).toBe('3')
    const both = twoLevel({ inner, outer })
    expect(capK(both)).toBe('3')
    // The store is untouched.
    expect(both.cap.data.variables.find((row) => row.name === 'k').value).toBe('1')
  })

  it('gives each subsystem of one super-module its own values', () => {
    const { nodes, edges } = heartGraph()
    const sm = nodes.filter((node) => node.data.scope === 'sm_1')
    const second = subsystem(sm, 'dndnode_3', 'heart2', 'sm_1', { overrides: { ra: { R: { value: '5' } } } })
    const expansion = expandHierarchy([...nodes, second], edges)
    expect(valueOf(expansion, 'dndnode_1/ra', 'R')).toBe('1')
    expect(valueOf(expansion, 'dndnode_3/ra', 'R')).toBe('5')
  })

  it('warns of overrides whose variable or child is gone', () => {
    const { nodes, edges } = heartGraph({ overrides: { ra: { gone: { value: '1' } }, nobody: { R: { value: '1' } }, '@': { c: { value: '1' } } } })
    const kinds = expandHierarchy(nodes, edges).errors.map((error) => [error.kind, error.severity, error.message])
    expect(kinds).toEqual([
      ['orphanedOverride', 'warning', expect.stringContaining('"ra" variable "gone"')],
      ['orphanedOverride', 'warning', expect.stringContaining('"nobody" variable "R"')],
    ])
  })

  it('keeps local constant keys of nested subsystems for H13', () => {
    const { nodes, edges } = twoLevel({ outer: { 'bed/@': { c: { value: '1' } }, '@': { d: { value: '2' } } } })
    expect(expandHierarchy(nodes, edges).errors).toEqual([])
  })

  it('places an orphaned override of a nested subsystem at each place it expands', () => {
    const { nodes, edges } = twoLevel({ inner: { cap: { gone: { value: '1' } } } })
    const second = subsystem(nodes, 'dndnode_3', 'arm', 'sm_1')
    expect(expandHierarchy([...nodes, second], edges).errors).toEqual([
      expect.objectContaining({
        kind: 'orphanedOverride',
        origins: [
          { mainId: 'sm_1~bed', instanceChain: ['dndnode_1'] },
          { mainId: 'sm_1~bed', instanceChain: ['dndnode_3'] },
        ],
      }),
    ])
  })
})

describe('expandHierarchy edge order', () => {
  it('puts edges from outside before siblings’ on a child’s inputs, and after them on its outputs', () => {
    // host → sub(c) and c → host, with c also fed by and feeding its sibling s.
    const general = port('general_ports', 'link', ['x'], 'True')
    const c = module('c', 'c', { scope: 'sm_1', ports: [general] })
    const s = module('s', 's', { scope: 'sm_1', ports: [{ ...general }] })
    const sm = supermodule('sm_1', 'sub', { submoduleOrder: ['c', 's'], exposedPorts: [exposed('xp', 'c', 'general_ports', 'link')] })
    const sub = subsystem([sm, c, s], 'dndnode_1', 'sub', 'sm_1')
    const host = module('dndnode_0', 'host', { ports: [{ ...general }] })
    const edges = [
      connect(sub, host, { id: 'out' }),
      connect(host, sub, { id: 'in' }),
      connect(c, s, { id: 'cs' }),
      connect(s, c, { id: 'sc' }),
    ]
    const ids = expandHierarchy([host, sub, sm, c, s], edges).edges.map((edge) => edge.id)
    const before = (a, b) => expect(ids.indexOf(a)).toBeLessThan(ids.indexOf(b))
    before('in#0', 'dndnode_1/sc') // c's inputs: host first
    before('dndnode_1/cs', 'out#0') // c's outputs: host last
  })

  it('keeps that order in CA’s out lists, and lists inputs by row, when the host row comes after the subsystem', () => {
    const general = port('general_ports', 'link', ['x'], 'True')
    const c = module('c', 'c', { scope: 'sm_1', ports: [general] })
    const s = module('s', 's', { scope: 'sm_1', ports: [{ ...general }] })
    const sm = supermodule('sm_1', 'sub', { submoduleOrder: ['c', 's'], exposedPorts: [exposed('xp', 'c', 'general_ports', 'link')] })
    const sub = subsystem([sm, c, s], 'dndnode_1', 'sub', 'sm_1')
    const host = module('dndnode_0', 'host', { ports: [{ ...general }] })
    const edges = [connect(host, sub, { id: 'in' }), connect(s, c, { id: 'sc' }), connect(c, s, { id: 'cs' }), connect(sub, host, { id: 'out' })]
    const expansion = expandHierarchy([sub, host, sm, c, s], edges)
    expect(expansion.edges.map((edge) => edge.id)).toEqual(['in#0', 'dndnode_1/sc', 'dndnode_1/cs', 'out#0'])
    const { rows, inpEdges, outEdges, unmatched } = orderForCa(expansion.nodes, expansion.edges)
    expect(rows.map((node) => node.id)).toEqual(['dndnode_1/c', 'dndnode_1/s', 'dndnode_0'])
    expect(outEdges.get('dndnode_1/c').map((edge) => edge.target)).toEqual(['dndnode_1/s', 'dndnode_0'])
    // CA wires by out lists; inp lists follow the rows, as for a flat model (see orderEdges).
    expect(inpEdges.get('dndnode_1/c').map((edge) => edge.source)).toEqual(['dndnode_1/s', 'dndnode_0'])
    expect(unmatched).toEqual([])
  })

  it('places a child reached through via by the port via resolves to, not the alias’s own fields', () => {
    const x = module('x', 'x', { scope: 'sm_2', ports: [port('exit_ports', 'q', ['b'], 'True')] })
    const inner = supermodule('sm_2', 'inner', { submoduleOrder: ['x'], exposedPorts: [exposed('xq', 'x', 'exit_ports', 'q')] })
    const a = module('a', 'a', { scope: 'sm_1', ports: [port('exit_ports', 'p', ['a'], 'True')] })
    const b = subsystem([inner, x], 'b', 'b', 'sm_2', { scope: 'sm_1' })
    const sm = supermodule('sm_1', 'sub', {
      submoduleOrder: ['a', 'b'],
      // xp_q's alias names its child and via only.
      exposedPorts: [{ id: 'xp_q', alias: { child: 'b', via: 'xq' } }, exposed('xp_p', 'a', 'exit_ports', 'p')],
    })
    const store = [sm, a, b, inner, x]
    const sub = subsystem(store, 'dndnode_1', 'sub', 'sm_1')
    const host = module('dndnode_0', 'host', { ports: [port('entrance_ports', 'p', ['a'], 'True'), port('entrance_ports', 'q', ['b'], 'True')] })
    const expansion = expandHierarchy([sub, host, ...store], [connect(sub, host, { id: 'e' })])
    expect(expansion.errors).toEqual([])
    expect(expansion.edges.map((edge) => [edge.id, edge.source])).toEqual([
      ['e#0', 'dndnode_1/b/x'],
      ['e#1', 'dndnode_1/a'],
    ])
  })

  it('splits an edge to a subsystem by child, in exposed port order', () => {
    const p = port('entrance_ports', 'p', ['x'], 'True')
    const q = port('entrance_ports', 'q', ['y'], 'True')
    const first = module('first', 'first', { scope: 'sm_1', ports: [{ ...q }] })
    const second = module('second', 'second', { scope: 'sm_1', ports: [{ ...p }] })
    const sm = supermodule('sm_1', 'sub', {
      submoduleOrder: ['first', 'second'],
      exposedPorts: [exposed('xp_p', 'second', 'entrance_ports', 'p'), exposed('xp_q', 'first', 'entrance_ports', 'q')],
    })
    const sub = subsystem([sm, first, second], 'dndnode_1', 'sub', 'sm_1')
    const host = module('dndnode_0', 'host', { ports: [port('exit_ports', 'q', ['b'], 'True'), port('exit_ports', 'p', ['a'], 'True')] })
    const edges = expandHierarchy([host, sub, sm, first, second], [connect(host, sub, { id: 'e' })]).edges
    expect(edges.map((edge) => [edge.id, edge.target])).toEqual([
      ['e#0', 'dndnode_1/second'],
      ['e#1', 'dndnode_1/first'],
    ])
  })
})

describe('expandHierarchy errors', () => {
  it('reports a coupling to a port the super-module no longer exposes, and keeps the rest', () => {
    const { nodes, edges } = heartGraph()
    const sm = nodes.find((node) => node.id === 'sm_1')
    sm.data.supermodule.exposedPorts = sm.data.supermodule.exposedPorts.filter((p) => p.id !== 'xp_out')
    const expansion = expandHierarchy(nodes, edges)
    expect(expansion.errors).toEqual([
      expect.objectContaining({
        kind: 'unresolvedAlias',
        origins: [{ mainId: 'e_out', instanceChain: [], edgeId: 'e_out' }, { mainId: 'dndnode_1', instanceChain: [] }],
      }),
    ])
    expect(expansion.edges.map((edge) => edge.id)).toEqual(['e_in#0', 'dndnode_1/e_int'])
  })

  it('reports an edge to a subsystem that couples nothing, rather than dropping it', () => {
    for (const data of [{ couplings: [] }, undefined]) {
      const { nodes, edges } = heartGraph()
      const into = edges.find((edge) => edge.id === 'e_in')
      into.data = data
      const expansion = expandHierarchy(nodes, edges)
      expect(expansion.errors).toEqual([
        expect.objectContaining({
          kind: 'emptyBoundaryEdge',
          severity: 'error',
          message: 'Edge "e_in" to "heart" couples no exposed port, so it can\'t be expanded.',
          origins: [{ mainId: 'e_in', instanceChain: [], edgeId: 'e_in' }],
        }),
      ])
      expect(expansion.edges.map((edge) => edge.id)).toEqual(['e_out#0', 'dndnode_1/e_int'])
    }
  })

  it('calls a coupling to a port the subsystem flags broken broken', () => {
    const { nodes, edges, heart } = heartGraph()
    nodes.find((node) => node.id === 'sm_1').data.supermodule.exposedPorts.pop()
    heart.data.broken = ['xp_out']
    expect(expandHierarchy(nodes, edges).errors.map((error) => error.kind)).toEqual(['brokenCoupling'])
  })

  it('reports a subsystem whose super-module is missing', () => {
    const { nodes, edges } = heartGraph()
    const expansion = expandHierarchy(
      nodes.filter((node) => node.id !== 'sm_1'),
      edges
    )
    expect(expansion.errors.map((error) => error.kind)).toEqual(['missingSupermodule', 'unresolvedAlias', 'unresolvedAlias'])
  })

  it('reports a super-module that contains itself', () => {
    const sm = supermodule('sm_1', 'loop', { submoduleOrder: ['x', 'self'] })
    const x = vessel('x', 'x', { scope: 'sm_1' })
    const self = subsystem([sm, x], 'self', 'self', 'sm_1', { scope: 'sm_1' })
    const top = subsystem([sm, x], 'dndnode_0', 'top', 'sm_1')
    const expansion = expandHierarchy([top, sm, x, self], [])
    expect(expansion.errors).toEqual([expect.objectContaining({ kind: 'cycle', origins: [{ mainId: 'sm_1~self', instanceChain: ['dndnode_0'] }] })])
    expect(expansion.nodes.map((node) => node.id)).toEqual(['dndnode_0/x'])
  })

  it('stops nesting deeper than CA’s 64 levels', () => {
    const levels = 65
    const nodes = [subsystem([], 'dndnode_0', 'top', 'sm_0')]
    for (let i = 0; i < levels; i++) {
      nodes.push(supermodule(`sm_${i}`, `level${i}`, { submoduleOrder: ['in'] }))
      nodes.push(i + 1 < levels ? subsystem([], 'in', 'in', `sm_${i + 1}`, { scope: `sm_${i}` }) : vessel('in', 'in', { scope: `sm_${i}` }))
    }
    expect(expandHierarchy(nodes, []).errors.map((error) => error.kind)).toEqual(['depth'])
    nodes.splice(1, 2, supermodule('sm_0', 'level0', { submoduleOrder: ['leaf'] }), vessel('leaf', 'leaf', { scope: 'sm_0' }))
    expect(expandHierarchy(nodes, []).nodes.map((node) => node.id)).toEqual(['dndnode_0/leaf'])
  })

  it('reports a single-connection port connected inside and from outside', () => {
    const single = port('general_ports', 'link', ['x'])
    const c = module('c', 'c', { scope: 'sm_1', ports: [single] })
    const s = module('s', 's', { scope: 'sm_1', ports: [{ ...single }] })
    const sm = supermodule('sm_1', 'sub', { submoduleOrder: ['c', 's'], exposedPorts: [exposed('xp', 'c', 'general_ports', 'link')] })
    const sub = subsystem([sm, c, s], 'dndnode_1', 'sub', 'sm_1')
    const host = module('dndnode_0', 'host', { ports: [{ ...single }] })
    const errors = expandHierarchy([host, sub, sm, c, s], [connect(host, sub, { id: 'in' }), connect(s, c, { id: 'sc' })]).errors
    expect(errors).toEqual([
      expect.objectContaining({
        kind: 'overSubscribed',
        message: expect.stringContaining('"sub/c" has no free "link" slot'),
        origins: [
          { mainId: 'sc', instanceChain: ['dndnode_1'], edgeId: 'sc' },
          { mainId: 'sm_1~s', instanceChain: ['dndnode_1'] },
          { mainId: 'sm_1~c', instanceChain: ['dndnode_1'] },
        ],
      }),
    ])
  })

  it('allows a variable summed through two ports across levels', () => {
    const sumA = port('entrance_ports', 'a', ['v'], 'Sum')
    const sumB = port('entrance_ports', 'b', ['v'], 'Sum')
    const c = module('c', 'c', { scope: 'sm_1', ports: [sumA, sumB] })
    const s = module('s', 's', { scope: 'sm_1', ports: [port('exit_ports', 'b', ['w'], 'True')] })
    const sm = supermodule('sm_1', 'sub', { submoduleOrder: ['c', 's'], exposedPorts: [exposed('xp', 'c', 'entrance_ports', 'a')] })
    const sub = subsystem([sm, c, s], 'dndnode_1', 'sub', 'sm_1')
    const host = module('dndnode_0', 'host', { ports: [port('exit_ports', 'a', ['w'], 'True')] })
    const errors = expandHierarchy([host, sub, sm, c, s], [connect(host, sub, { id: 'in' }), connect(s, c, { id: 'sc' })]).errors
    expect(errors.map((error) => error.kind)).not.toContain('sharedSum')
  })

  it('reports flat names given twice', () => {
    const { nodes, edges } = heartGraph()
    nodes.find((node) => node.id === 'dndnode_0').data.name = 'heart__ra'
    const errors = expandHierarchy(nodes, edges).errors
    expect(errors.filter((error) => error.kind === 'flatNameClash')).toEqual([
      expect.objectContaining({ ids: ['dndnode_0', 'dndnode_1/ra'], message: '"heart__ra", "heart/ra" all have the flat name "heart__ra".' }),
    ])
    // Their rows clash as well.
    expect(errors.filter((error) => error.kind === 'parameterNameClash').map((error) => error.convention)).toEqual(['cellml', 'ca'])
  })

  it('reports parameter names the CellML export gives twice', () => {
    // inst a's b_E and inst a_b's E, each set by two modules, both become a_b_E.
    const nodes = [
      module('n1', 'a', { variables: [constant('b_E', '1')] }),
      module('n2', 'x', { variables: [constant('b_E', '1')] }),
      module('n3', 'a_b', { variables: [constant('E', '1')] }),
      module('n4', 'y', { variables: [constant('E', '1')] }),
    ]
    const errors = expandHierarchy(nodes, []).errors
    expect(errors).toEqual([
      expect.objectContaining({ kind: 'parameterNameClash', convention: 'cellml', ids: ['n1', 'n3'], message: expect.stringContaining('"a_b_E"') }),
    ])
  })

  it('reports parameter names the CA export gives twice', () => {
    // a_b's E and b's E_a are both E_a_b.
    const nodes = [module('n1', 'a_b', { variables: [constant('E', '1')] }), module('n2', 'b', { variables: [constant('E_a', '2')] })]
    expect(expandHierarchy(nodes, []).errors).toEqual([
      expect.objectContaining({ kind: 'parameterNameClash', convention: 'ca', ids: ['n1', 'n2'] }),
    ])
  })
})

describe('subsystemPorts', () => {
  it('copies each aliased port with its exposed port id and label', () => {
    const { nodes, ra } = heartGraph()
    const sm = nodes.find((node) => node.id === 'sm_1')
    sm.data.supermodule.exposedPorts[0].label = 'venous_in'
    expect(subsystemPorts(nodes, 'sm_1')).toEqual([
      { ...ra.data.ports[0], label: 'venous_in', exposedPortId: 'xp_in' },
      { ...OUT, exposedPortId: 'xp_out' },
    ])
  })

  it('follows via to the grandchild’s port, the outer label first and then the inner', () => {
    const { nodes, cap, art } = twoLevel()
    expect(subsystemPorts(nodes, 'sm_1')).toEqual([
      { ...art.data.ports[0], exposedPortId: 'xp_a' },
      { ...cap.data.ports[1], exposedPortId: 'xp_b' },
    ])
    nodes.find((node) => node.id === 'sm_2').data.supermodule.exposedPorts[1].label = 'drain'
    expect(subsystemPorts(nodes, 'sm_1')[1]).toEqual({ ...cap.data.ports[1], label: 'drain', exposedPortId: 'xp_b' })
    nodes.find((node) => node.id === 'sm_1').data.supermodule.exposedPorts[1].label = 'outflow'
    expect(subsystemPorts(nodes, 'sm_1')[1]).toEqual({ ...cap.data.ports[1], label: 'outflow', exposedPortId: 'xp_b' })
  })
})
