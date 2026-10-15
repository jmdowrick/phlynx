import { describe, expect, it } from 'vitest'

import { expandHierarchy } from '../../../../src/services/hierarchy/expand.js'
import { indexExposures } from '../../../../src/services/hierarchy/exposure.js'
import { makeUnique, modelIdMap, nestProblem, nestSelection, unnest } from '../../../../src/services/hierarchy/operations.js'
import { isSubsystem, isSupermoduleInterface } from '../../../../src/utils/hierarchy.js'
import { connect, constant, exposed, exposures, module, port, shuffled, subsystem, supermodule } from '../../fixtures/hierarchy/graph.js'

const IN = port('entrance_ports', 'vessel', ['v_in', 'u'])
const OUT = port('exit_ports', 'vessel', ['v', 'u_out'])
const SUM_IN = port('entrance_ports', 'vessel', ['v_sum', 'u'], ['sum', 'True'])
const vessel = (localId, name, options = {}) =>
  module(localId, name, { ports: [{ ...IN }, { ...OUT }], variables: [constant('R', '1'), constant('k', localId)], ...options })

/** a → b → c → d at the root. */
function chain() {
  const nodes = ['a', 'b', 'c', 'd'].map((name, i) => vessel(`dndnode_${i}`, name))
  const used = new Set()
  return { nodes, edges: [0, 1, 2].map((i) => connect(nodes[i], nodes[i + 1], { used })) }
}

/** Three terminals feeding one vein's summing inlet, which drains to an outlet. */
function fanIn() {
  const terms = [0, 1, 2].map((i) => vessel(`dndnode_${i}`, `t${i}`))
  const vein = module('dndnode_3', 'vein', { ports: [{ ...SUM_IN }, { ...OUT }], variables: [constant('C', '2')] })
  const out = vessel('dndnode_4', 'out')
  const used = new Set()
  return { nodes: [...terms, vein, out], edges: [...terms.map((term) => connect(term, vein, { used })), connect(vein, out, { used })] }
}

/** Root a → heart (sm_1: ra → lv) → b, heart overriding lv's R. */
function heart() {
  const ra = vessel('ra', 'ra', { scope: 'sm_1' })
  const lv = vessel('lv', 'lv', { scope: 'sm_1' })
  const sm = supermodule('sm_1', 'heart', { submoduleOrder: ['ra', 'lv'] })
  const exposure = exposures('sm_1', [exposed('xp_in', 'ra', 'entrance_ports', 'vessel'), exposed('xp_out', 'lv', 'exit_ports', 'vessel')])
  const inner = [sm, ra, lv]
  const h = subsystem({ nodes: inner, edges: exposure }, 'dndnode_1', 'heart', 'sm_1', { overrides: { lv: { R: { value: '9' } } } })
  const a = vessel('dndnode_0', 'a')
  const b = vessel('dndnode_2', 'b')
  const used = new Set()
  return {
    nodes: [a, h, b, ...inner],
    edges: [connect(a, h, { used }), connect(h, b, { used }), connect(ra, lv, { id: 'e_int' }), ...exposure],
  }
}

/** Root aorta → leg (limb: art → bed) → vc, bed (bedsm: cap) nested in limb, with overrides at both levels. */
function twoLevel() {
  const cap = vessel('cap', 'cap', { scope: 'sm_2' })
  const bedsm = supermodule('sm_2', 'bedsm', { submoduleOrder: ['cap'] })
  const bedExposure = exposures('sm_2', [exposed('xp_in', 'cap', 'entrance_ports', 'vessel'), exposed('xp_out', 'cap', 'exit_ports', 'vessel')])
  const art = vessel('art', 'art', { scope: 'sm_1' })
  const bed = subsystem({ nodes: [bedsm, cap], edges: bedExposure }, 'bed', 'bed', 'sm_2', { scope: 'sm_1', overrides: { cap: { R: { value: '2' } } } })
  const limb = supermodule('sm_1', 'limb', { submoduleOrder: ['art', 'bed'] })
  const exposure = [
    ...exposures('sm_1', [exposed('xp_a', 'art', 'entrance_ports', 'vessel'), exposed('xp_b', 'bed', 'exit_ports', 'vessel', { via: 'xp_out' })]),
    ...bedExposure,
  ]
  const store = [limb, art, bed, bedsm, cap]
  const leg = subsystem({ nodes: store, edges: exposure }, 'dndnode_1', 'leg', 'sm_1', { overrides: { 'bed/cap': { R: { value: '3' } }, art: { k: { value: 'x' } } } })
  const aorta = vessel('dndnode_0', 'aorta')
  const vc = vessel('dndnode_2', 'vc')
  const used = new Set()
  return {
    nodes: [aorta, leg, vc, ...store],
    edges: [connect(aorta, leg, { used }), connect(leg, vc, { used }), connect(art, bed, { id: 'e_ab' }), ...exposure],
  }
}

/** One super-module (seg: s) used three times in series, each subsystem with its own R. */
function threeInstances() {
  const s = vessel('s', 's', { scope: 'sm_1' })
  const sm = supermodule('sm_1', 'seg', { submoduleOrder: ['s'] })
  const exposure = exposures('sm_1', [exposed('xp_in', 's', 'entrance_ports', 'vessel'), exposed('xp_out', 's', 'exit_ports', 'vessel')])
  const inner = { nodes: [sm, s], edges: exposure }
  const segs = ['2', '3', '5'].map((value, i) => subsystem(inner, `dndnode_${i}`, `seg${i + 1}`, 'sm_1', { overrides: { s: { R: { value } } } }))
  const used = new Set()
  return { nodes: [...segs, sm, s], edges: [connect(segs[0], segs[1], { used }), connect(segs[1], segs[2], { used }), ...exposure] }
}

/** The model a store stands for, by names: each module's rows, and each edge's couplings. */
function signature({ nodes, edges }, rename = (id) => id) {
  const expansion = expandHierarchy(nodes, edges)
  expect(expansion.errors.filter((error) => error.severity === 'error')).toEqual([])
  const nameOf = (id) => rename(id, expansion)
  const end = (port, slot) => `${port.portType}:${port.label}:${slot}[${port.variables}|${port.multiportType}]`
  return {
    nodes: expansion.nodes.map((node) => `${nameOf(node.id)}: ${node.data.variables.map((row) => `${row.name}=${row.value}`).join(',')}`).sort(),
    edges: expansion.edges
      .map((edge) => {
        const couplings = edge.data.couplings.map((c) => `${end(c.sourcePort, c.sourceSlot)} > ${end(c.targetPort, c.targetSlot)}`)
        return `${nameOf(edge.source)} > ${nameOf(edge.target)}: ${couplings.sort().join(', ')}`
      })
      .sort(),
  }
}

/** Expects an edit to leave the model as it was, its modules found through the edit's model id map. */
function expectSameModel(before, after) {
  const { idMap, nameOf } = modelIdMap(before, after, after.rewrite)
  const renamed = signature(before, (id) => nameOf(idMap.get(id) ?? id))
  expect(signature(after, (id, expansion) => expansion.nameOf(id))).toEqual(renamed)
  return idMap
}

describe('nestSelection', () => {
  it('nests a chain’s middle into one subsystem the model reads as before', () => {
    const g = chain()
    const after = nestSelection(g.nodes, g.edges, ['dndnode_1', 'dndnode_2'], { name: 'mid' })
    expect(after.problems).toEqual([])
    expect(after.nodes.filter(isSubsystem)).toHaveLength(1)
    expect(after.nodes.find(isSubsystem)).toMatchObject({ id: 'dndnode_4', data: { name: 'mid', smId: 'sm_0', scope: null } })
    expect(after.nodes.filter((node) => node.data.scope === 'sm_0').map((node) => node.id)).toEqual(['sm_0', 'sm_0~dndnode_1', 'sm_0~dndnode_2'])
    // Two exposed ports, in the order the cut edges come: b's inlet, then c's outlet.
    expect(indexExposures(after.nodes, after.edges).get('sm_0').map((p) => [p.id, p.alias])).toEqual([
      ['xp_0', { child: 'dndnode_1', portType: 'entrance_ports', label: 'vessel', slot: 0 }],
      ['xp_1', { child: 'dndnode_2', portType: 'exit_ports', label: 'vessel', slot: 0 }],
    ])
    const idMap = expectSameModel(g, after)
    expect([...idMap]).toEqual([
      ['dndnode_1', 'dndnode_4/dndnode_1'],
      ['dndnode_2', 'dndnode_4/dndnode_2'],
    ])
    expect(expandHierarchy(after.nodes, after.edges).nameOf('dndnode_4/dndnode_1')).toBe('mid__b')
  })

  it('keeps the model for every selection of a chain, and with edges in any order', () => {
    const subsets = [['dndnode_0'], ['dndnode_3'], ['dndnode_0', 'dndnode_1'], ['dndnode_0', 'dndnode_2'], ['dndnode_1', 'dndnode_2', 'dndnode_3'], ['dndnode_0', 'dndnode_1', 'dndnode_2', 'dndnode_3']]
    for (const seed of [0, 3, 11]) {
      const g = chain()
      if (seed) g.edges = shuffled(g.edges, seed)
      for (const ids of subsets) {
        const after = nestSelection(g.nodes, g.edges, ids, { name: 'sub' })
        expect(after.problems, ids.join()).toEqual([])
        expectSameModel(g, after)
      }
    }
  })

  it('exposes a summing inlet several cut edges use once, each outside edge coupling to it', () => {
    const g = fanIn()
    const after = nestSelection(g.nodes, g.edges, ['dndnode_3', 'dndnode_4'], { name: 'veins' })
    expect(after.problems).toEqual([])
    const ports = indexExposures(after.nodes, after.edges).get('sm_0')
    expect(ports.map((p) => p.alias.label)).toEqual(['vessel'])
    const intoVeins = after.edges.filter((edge) => edge.target === after.subsystemId)
    expect(intoVeins).toHaveLength(3)
    for (const edge of intoVeins) expect(edge.data.couplings[0].targetPort.exposedPortId).toBe(ports[0].id)
    expectSameModel(g, after)
  })

  it('joins the cut edges from one node outside, the same way, into one edge', () => {
    const g = fanIn()
    const after = nestSelection(g.nodes, g.edges, ['dndnode_0', 'dndnode_1'], { name: 'terms' })
    expect(after.problems).toEqual([])
    const out = after.edges.filter((edge) => edge.source === after.subsystemId)
    expect(out.map((edge) => edge.target)).toEqual(['dndnode_3'])
    expect(out[0].data.couplings.map((c) => c.sourcePort.exposedPortId)).toEqual(['xp_0', 'xp_1'])
    expectSameModel(g, after)
    const back = unnest(after.nodes, after.edges, after.subsystemId)
    expect(back.edges.filter((edge) => edge.target === 'dndnode_3')).toHaveLength(3)
    expectSameModel(g, { ...back, rewrite: (chain) => back.rewrite(after.rewrite(chain)) })
  })

  it('nests inside a super-module, re-exposing what its interface exposed and keeping its subsystem’s overrides', () => {
    const g = twoLevel()
    const after = nestSelection(g.nodes, g.edges, ['sm_1~art', 'sm_1~bed'], { name: 'inner' })
    expect(after.problems).toEqual([])
    const limb = after.nodes.find((node) => node.id === 'sm_1')
    expect(limb.data.supermodule.submoduleOrder).toEqual([after.subsystemId.split('~')[1]])
    // limb's exposed ports keep their ids, now through the new subsystem.
    expect(indexExposures(after.nodes, after.edges).get('sm_1').map((p) => p.id)).toEqual(['xp_a', 'xp_b'])
    // leg's overrides reach their modules through the new subsystem.
    const leg = after.nodes.find((node) => node.id === 'dndnode_1')
    const local = after.subsystemId.split('~')[1]
    expect(leg.data.overrides).toEqual({ [`${local}/bed/cap`]: { R: { value: '3' } }, [`${local}/art`]: { k: { value: 'x' } } })
    const idMap = expectSameModel(g, after)
    expect(idMap.get('dndnode_1/bed/cap')).toBe(`dndnode_1/${local}/bed/cap`)
  })

  it('nests subsystems of one super-module three times over, as the model was', () => {
    const g = threeInstances()
    for (const ids of [['dndnode_1'], ['dndnode_0', 'dndnode_1'], ['dndnode_0', 'dndnode_1', 'dndnode_2']]) {
      const after = nestSelection(g.nodes, g.edges, ids, { name: 'pair' })
      expect(after.problems).toEqual([])
      expectSameModel(g, after)
    }
  })

  it('refuses an interface node, nodes of two scopes, a name in use and nothing at all', () => {
    const g = heart()
    expect(nestProblem(g.nodes, [])).toMatch(/Select/)
    expect(nestProblem(g.nodes, ['sm_1~ra', 'sm_1'])).toMatch(/interface/)
    expect(nestProblem(g.nodes, ['dndnode_0', 'sm_1~ra'])).toMatch(/one scope/)
    expect(nestSelection(g.nodes, g.edges, ['dndnode_0'], { name: 'heart' }).problems[0]).toMatch(/already called/)
    expect(nestSelection(g.nodes, g.edges, ['dndnode_0'], { name: 'b' }).problems[0]).toMatch(/already used/)
    expect(nestSelection(g.nodes, g.edges, ['dndnode_0'], { name: 'x__y' }).problems[0]).toMatch(/__/)
  })
})

describe('unnest', () => {
  it('inlines a subsystem, baking its overrides and keeping its children’s flat names', () => {
    const g = heart()
    const after = unnest(g.nodes, g.edges, 'dndnode_1')
    expect(after.problems).toEqual([])
    expect(after.removedSupermodule).toBe(true)
    expect(after.nodes.some((node) => isSubsystem(node) || isSupermoduleInterface(node))).toBe(false)
    expect(after.nodes.map((node) => node.data.name)).toEqual(['a', 'heart__ra', 'heart__lv', 'b'])
    expect(after.nodes.find((node) => node.data.name === 'heart__lv').data.variables.find((row) => row.name === 'R').value).toBe('9')
    expectSameModel(g, after)
  })

  it('inlines a nested subsystem, its outer overrides winning and outer keys following', () => {
    const g = twoLevel()
    const after = unnest(g.nodes, g.edges, 'sm_1~bed')
    expect(after.problems).toEqual([])
    const leg = after.nodes.find((node) => node.id === 'dndnode_1')
    const cap = after.nodes.find((node) => node.data.name === 'bed_cap')
    expect(cap.data.scope).toBe('sm_1')
    expect(cap.data.variables.find((row) => row.name === 'R').value).toBe('2')
    expect(leg.data.overrides).toEqual({ [cap.data.localId]: { R: { value: '3' } }, art: { k: { value: 'x' } } })
    expect(indexExposures(after.nodes, after.edges).get('sm_1').map((p) => [p.id, p.alias.child])).toEqual([
      ['xp_a', 'art'],
      ['xp_b', cap.data.localId],
    ])
    expectSameModel(g, after)
  })

  it('copies a shared super-module’s children, leaving its other subsystems as they are', () => {
    const g = threeInstances()
    const after = unnest(g.nodes, g.edges, 'dndnode_1')
    expect(after.removedSupermodule).toBe(false)
    expect(after.nodes.filter(isSubsystem).map((node) => node.id)).toEqual(['dndnode_0', 'dndnode_2'])
    const idMap = expectSameModel(g, after)
    expect([...idMap.keys()]).toEqual(['dndnode_1/s'])
  })

  it('undoes a nest: the model, every row and coupling, as it was, whatever the edge order', () => {
    for (const [name, make, ids] of [
      ['chain', chain, ['dndnode_1', 'dndnode_2']],
      ['fan-in', fanIn, ['dndnode_0', 'dndnode_3']],
      ['heart', heart, ['dndnode_0', 'dndnode_1']],
      ['two levels', twoLevel, ['sm_1~art', 'sm_1~bed']],
      ['three instances', threeInstances, ['dndnode_1', 'dndnode_2']],
    ]) {
      for (const seed of [0, 5]) {
        const g = make()
        if (seed) g.edges = shuffled(g.edges, seed)
        const nested = nestSelection(g.nodes, g.edges, ids, { name: 'wrap' })
        expect(nested.problems, name).toEqual([])
        const back = unnest(nested.nodes, nested.edges, nested.subsystemId)
        expect(back.problems, name).toEqual([])
        const composed = { ...back, rewrite: (chainIds) => back.rewrite(nested.rewrite(chainIds)) }
        expectSameModel(g, composed)
        expect(back.nodes, name).toHaveLength(g.nodes.length)
        expect(back.edges, name).toHaveLength(g.edges.length)
        expect(back.nodes.filter(isSupermoduleInterface).length, name).toBe(g.nodes.filter(isSupermoduleInterface).length)
      }
    }
  })
})

describe('makeUnique', () => {
  it('forks a super-module for one subsystem, the others’ model unchanged', () => {
    const g = threeInstances()
    const after = makeUnique(g.nodes, g.edges, 'dndnode_1')
    expect(after.problems).toEqual([])
    expect(after.smId).toBe('sm_2')
    expect(after.nodes.find((node) => node.id === 'dndnode_1').data.smId).toBe('sm_2')
    expect(after.nodes.find((node) => node.id === 'sm_2').data.supermodule.name).toBe('seg_2')
    expect(after.nodes.find((node) => node.id === 'sm_2~s').data).toMatchObject({ scope: 'sm_2', localId: 's' })
    // Its exposed ports keep their ids, so the couplings to it still resolve.
    expect(indexExposures(after.nodes, after.edges).get('sm_2').map((p) => p.id)).toEqual(['xp_in', 'xp_out'])
    const idMap = expectSameModel(g, after)
    expect(idMap.size).toBe(0)
    const others = (store) => expandHierarchy(store.nodes, store.edges).nodes.filter((node) => !node.id.startsWith('dndnode_1/'))
    expect(others(after)).toEqual(others(g))
    // Its one exposure edge, copied.
    expect(after.edges).toHaveLength(g.edges.length + 1)
  })

  it('refuses what isn’t a subsystem', () => {
    const g = chain()
    expect(makeUnique(g.nodes, g.edges, 'dndnode_0').problems[0]).toMatch(/not a subsystem/)
  })
})
