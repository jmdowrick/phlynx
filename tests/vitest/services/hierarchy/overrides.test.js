import { describe, expect, it } from 'vitest'

import { expandHierarchy } from '../../../../src/services/hierarchy/expand.js'
import {
  aggregateProvenance,
  inheritedRows,
  keyOf,
  overridesOf,
  provenanceOf,
  withOverrides,
  writeTargetOf,
} from '../../../../src/services/hierarchy/overrides.js'
import { connect, constant, exposed, exposures, module, port, subsystem, supermodule } from '../../fixtures/hierarchy/graph.js'

const vessel = (localId, name, options = {}) =>
  module(localId, name, {
    ports: [port('entrance_ports', 'vessel', ['u']), port('exit_ports', 'vessel', ['u_out'])],
    variables: [
      constant('R', '1'),
      { name: 'u', type: 'boundary_condition', value: '5', units: 'dimensionless' },
      { name: 'u_out', type: 'variable', value: null, units: 'dimensionless' },
    ],
    ...options,
  })

/**
 * Root src → leg, leg and arm subsystems of limb (sm_1: art → bed), bed one of bedsm (sm_2: cap), which sets cap's R
 * to 2; leg sets it again to 3.
 */
function legGraph() {
  const cap = vessel('cap', 'cap', { scope: 'sm_2' })
  const bedsm = supermodule('sm_2', 'bedsm', { submoduleOrder: ['cap'] })
  const bedExposure = exposures('sm_2', [exposed('xp_in', 'cap', 'entrance_ports', 'vessel')])
  const art = vessel('art', 'art', { scope: 'sm_1' })
  const bed = subsystem({ nodes: [bedsm, cap], edges: bedExposure }, 'bed', 'bed', 'sm_2', { scope: 'sm_1', overrides: { cap: { R: { value: '2' } } } })
  const limb = supermodule('sm_1', 'limb', { submoduleOrder: ['art', 'bed'] })
  const exposure = [...exposures('sm_1', [exposed('xp_a', 'art', 'entrance_ports', 'vessel')]), ...bedExposure]
  const store = { nodes: [limb, art, bed, bedsm, cap], edges: exposure }
  const leg = subsystem(store, 'dndnode_1', 'leg', 'sm_1', { overrides: { 'bed/cap': { R: { value: '3' } }, gone: { R: { value: '1' } }, art: { nope: { value: '1' } } } })
  const arm = subsystem(store, 'dndnode_3', 'arm', 'sm_1')
  const src = vessel('dndnode_0', 'src')
  const nodes = [src, leg, arm, ...store.nodes]
  const edges = [connect(src, leg, { id: 'e0' }), connect(art, bed, { id: 'e1' }), ...exposure]
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return { nodes, edges, findNode: (id) => byId.get(id), model: expandHierarchy(nodes, edges) }
}

describe('writeTargetOf', () => {
  const { model, findNode } = legGraph()

  it('writes for this subsystem on the outermost one, under the path below it', () => {
    expect(writeTargetOf('dndnode_1/bed/cap', 'instance', model.origin, findNode)).toEqual({ nodeId: 'dndnode_1', field: 'overrides', key: 'bed/cap' })
    expect(keyOf('dndnode_1/bed/cap')).toBe('bed/cap')
  })

  it('writes the super-module’s default to the child’s own rows, and a root module’s to its own', () => {
    expect(writeTargetOf('dndnode_1/bed/cap', 'supermodule', model.origin, findNode)).toEqual({ nodeId: 'sm_2~cap', field: 'variables' })
    expect(writeTargetOf('dndnode_0', 'instance', model.origin, findNode)).toEqual({ nodeId: 'dndnode_0', field: 'variables' })
    expect(writeTargetOf('sm_1~art', 'supermodule', model.origin, findNode)).toEqual({ nodeId: 'sm_1~art', field: 'variables' })
  })

  it('has no subsystem to write for when a super-module is edited on its own', () => {
    expect(writeTargetOf('sm_1~art', 'instance', model.origin, findNode)).toEqual({ problem: expect.stringMatching(/no subsystem/) })
    expect(writeTargetOf('nope', 'instance', model.origin, findNode)).toBeNull()
    expect(() => writeTargetOf('dndnode_0', 'all', model.origin, findNode)).toThrow('Unknown write target')
  })
})

describe('inherited values and overrides', () => {
  const { model, findNode } = legGraph()

  it('gives a module’s rows without the outermost override, inner overrides applied', () => {
    expect(model.nodes.find((node) => node.id === 'dndnode_1/bed/cap').data.variables[0].value).toBe('3')
    expect(inheritedRows('dndnode_1/bed/cap', model.origin.get('dndnode_1/bed/cap'), findNode)[0].value).toBe('2')
  })

  it('sets only what differs from the inherited value, and clears the rest', () => {
    const inherited = [constant('R', '2'), constant('C', '4')]
    expect(withOverrides({}, 'bed/cap', { R: { value: '7', type: 'boundary_condition' } }, inherited)).toEqual({ 'bed/cap': { R: { value: '7' } } })
    expect(withOverrides({ 'bed/cap': { R: { value: '7' } } }, 'bed/cap', { R: { value: '2' } }, inherited)).toEqual({})
    expect(withOverrides({ 'bed/cap': { R: { value: '7' } }, art: {} }, 'bed/cap', { R: null, C: { value: '5' } }, inherited)).toEqual({
      'bed/cap': { C: { value: '5' } },
      art: {},
    })
  })
})

describe('provenanceOf', () => {
  it('says which values this subsystem overrides, which export ignores, and the chip to show', () => {
    const { model, findNode } = legGraph()
    const leg = provenanceOf('dndnode_1/bed/cap', model, findNode)
    expect(leg.get('R')).toMatchObject({ value: '3', inherited: '2', isOverridden: true, isIgnored: false, chip: 'overridden' })
    // cap's u is supplied through bed's interface by art, so its own value is ignored.
    expect(leg.get('u')).toMatchObject({ isOverridden: false, isIgnored: true, chip: 'ignored', status: { state: 'connected' } })
    expect(provenanceOf('dndnode_3/bed/cap', model, findNode).get('R')).toMatchObject({ value: '2', inherited: '2', chip: 'default' })
    expect(provenanceOf('dndnode_0', model, findNode).get('R')).toMatchObject({ value: '1', inherited: '1', chip: 'default' })
    expect(provenanceOf('gone', model, findNode).size).toBe(0)
  })
})

describe('aggregateProvenance', () => {
  it('sums up a super-module’s module across its copies, as editing the super-module shows it', () => {
    const { model, findNode } = legGraph()
    const art = aggregateProvenance('sm_1~art', model, findNode)
    // leg's art is fed by src, arm's by nothing.
    expect(art.get('u')).toMatchObject({ total: 2, ignored: 1, summary: 'connected in 1/2' })
    expect(art.get('R')).toMatchObject({ total: 2, overridden: 0, summary: '' })
    const cap = aggregateProvenance('sm_2~cap', model, findNode)
    expect(cap.get('R')).toMatchObject({ total: 2, overridden: 1 })
    expect(cap.get('u').summary).toBe('connected')
  })
})

describe('overridesOf', () => {
  it('lists a subsystem’s overrides by path, an orphaned one flagged, never dropped', () => {
    const { nodes } = legGraph()
    expect(overridesOf('dndnode_1', nodes)).toEqual([
      { key: 'bed/cap', path: 'bed/cap', variable: 'R', value: '3', isOrphaned: false },
      { key: 'gone', path: 'gone', variable: 'R', value: '1', isOrphaned: true },
      { key: 'art', path: 'art', variable: 'nope', value: '1', isOrphaned: true },
    ])
    expect(overridesOf('dndnode_0', nodes)).toEqual([])
  })
})
