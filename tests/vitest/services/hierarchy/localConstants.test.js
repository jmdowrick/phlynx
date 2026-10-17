import { describe, expect, it } from 'vitest'

import { expandHierarchy } from '../../../../src/services/hierarchy/expand.js'
import {
  asConstants,
  localConstantNameProblem,
  localConstantValue,
  planLocalConstantRemoval,
  planRetypeBinding,
  planShadowedOverrideRemoval,
} from '../../../../src/services/hierarchy/localConstants.js'
import { nestProblem, unnest, unnestProblem } from '../../../../src/services/hierarchy/operations.js'
import { localConstantTargetOf, overridesOf, provenanceOf } from '../../../../src/services/hierarchy/overrides.js'
import { connect, constant, exposed, exposures, module, port, superInstance, supermodule } from '../../fixtures/hierarchy/graph.js'

const IN = port('entrance_ports', 'vessel', ['v_in', 'u'])
const OUT = port('exit_ports', 'vessel', ['v', 'u_out'])
const local = (name) => ({ name, type: 'local_constant', value: '', units: 'dimensionless' })
const vessel = (localId, name, options = {}) => module(localId, name, { ports: [{ ...IN }, { ...OUT }], variables: [constant('R', '1')], ...options })

/**
 * Root a → seg1, seg2 (segment, sm_1: p → q, both binding k; declared 3) → b. seg1 overrides k under '@'.
 */
function segments({ declared = [{ name: 'k', units: 'dimensionless', value: '3' }], seg1 = { '@': { k: { value: '2' } } }, rows = [local('k')] } = {}) {
  const p = vessel('p', 'p', { scope: 'sm_1', variables: [constant('R', '1'), ...rows] })
  const q = vessel('q', 'q', { scope: 'sm_1', variables: [constant('R', '1'), ...rows] })
  const sm = supermodule('sm_1', 'segment', { submoduleOrder: ['p', 'q'], localConstants: declared })
  const exposure = exposures('sm_1', [exposed('xp_in', 'p', 'entrance_ports', 'vessel'), exposed('xp_out', 'q', 'exit_ports', 'vessel')])
  const inner = { nodes: [sm, p, q], edges: exposure }
  const s1 = superInstance(inner, 'dndnode_1', 'seg1', 'sm_1', { overrides: seg1 })
  const s2 = superInstance(inner, 'dndnode_2', 'seg2', 'sm_1')
  const a = vessel('dndnode_0', 'a')
  const b = vessel('dndnode_3', 'b')
  const used = new Set()
  const edges = [connect(a, s1, { used, id: 'e0' }), connect(s1, s2, { used, id: 'e1' }), connect(s2, b, { used, id: 'e2' }), connect(p, q, { id: 'e_int' }), ...exposure]
  return { nodes: [a, s1, s2, b, sm, p, q], edges }
}

/** Root leg (limb, sm_1: art, bed) where bed (bedsm, sm_2: cap) declares c, cap binding it. */
function twoLevel({ outer = {}, inner = {} } = {}) {
  const cap = vessel('cap', 'cap', { scope: 'sm_2', variables: [local('c')] })
  const bedsm = supermodule('sm_2', 'bedsm', { submoduleOrder: ['cap'], localConstants: [{ name: 'c', units: 'dimensionless', value: '1' }] })
  const bedExposure = exposures('sm_2', [exposed('xp_in', 'cap', 'entrance_ports', 'vessel'), exposed('xp_out', 'cap', 'exit_ports', 'vessel')])
  const art = vessel('art', 'art', { scope: 'sm_1' })
  const bed = superInstance({ nodes: [bedsm, cap], edges: bedExposure }, 'bed', 'bed', 'sm_2', { scope: 'sm_1', overrides: inner })
  const limb = supermodule('sm_1', 'limb', { submoduleOrder: ['art', 'bed'] })
  const limbExposure = exposures('sm_1', [exposed('xp_a', 'art', 'entrance_ports', 'vessel'), exposed('xp_b', 'bed', 'exit_ports', 'vessel', { via: 'xp_out' })])
  const store = [limb, art, bed, bedsm, cap]
  const exposure = [...limbExposure, ...bedExposure]
  const leg = superInstance({ nodes: store, edges: exposure }, 'dndnode_1', 'leg', 'sm_1', { overrides: outer })
  return { nodes: [leg, ...store], edges: [connect(art, bed, { id: 'e3' }), ...exposure] }
}

const rowOf = (expansion, id, name) => expansion.nodes.find((node) => node.id === id)?.data.variables.find((row) => row.name === name)
const valuesOf = ({ nodes }) =>
  Object.fromEntries(nodes.flatMap((node) => node.data.variables.filter((row) => row.type !== 'variable').map((row) => [`${node.data.name}.${row.name}`, row.value])))
/** @returns {Object} The values, their flat names starting `from` starting `to` instead. */
const renamedValues = (values, from, to) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key.startsWith(from) ? `${to}${key.slice(from.length)}` : key, value]))
const findNodeIn = (nodes) => (id) => nodes.find((node) => node.id === id)

describe('binding local constants', () => {
  it('gives each bound row its super instance’s value: the declared one, or its override', () => {
    const expansion = expandHierarchy(...Object.values(segments()))
    expect(expansion.errors).toEqual([])
    expect(rowOf(expansion, 'dndnode_1/p', 'k')).toEqual({ ...local('k'), value: '2', localConstant: { owner: 'seg1', units: 'dimensionless' } })
    expect(rowOf(expansion, 'dndnode_1/q', 'k').value).toBe('2')
    expect(rowOf(expansion, 'dndnode_2/p', 'k')).toMatchObject({ value: '3', localConstant: { owner: 'seg2' } })
    expect(rowOf(expansion, 'dndnode_2/q', 'k').value).toBe('3')
  })

  it('lets the outermost super instance win over an inner one’s own override', () => {
    const inner = { '@': { c: { value: '5' } } }
    expect(rowOf(expandHierarchy(...Object.values(twoLevel({ inner }))), 'dndnode_1/bed/cap', 'c')).toMatchObject({ value: '5', localConstant: { owner: 'leg__bed' } })
    const expansion = expandHierarchy(...Object.values(twoLevel({ inner, outer: { 'bed/@': { c: { value: '7' } } } })))
    expect(expansion.errors).toEqual([])
    expect(rowOf(expansion, 'dndnode_1/bed/cap', 'c').value).toBe('7')
  })

  it('applies overrides innermost first, from any level', () => {
    const chain = [{ data: { overrides: { 'bed/@': { c: { value: '7' } } } } }, { data: { overrides: { '@': { c: { value: '5' } } } } }]
    expect(localConstantValue(chain, ['leg', 'bed'], 'c', '1')).toBe('7')
    expect(localConstantValue(chain, ['leg', 'bed'], 'c', '1', 1)).toBe('5')
    expect(localConstantValue([], [], 'c', '1')).toBe('1')
  })

  it('binds only a super-module’s direct children: a nested one declares its own', () => {
    const { nodes, edges } = twoLevel()
    nodes.find((node) => node.id === 'sm_1~art').data.variables.push(local('c'))
    expect(expandHierarchy(nodes, edges).errors.map((error) => [error.kind, error.message])).toEqual([
      ['unknownLocalConstant', '"leg/art" variable "c" is a local constant, but super-module "limb" declares none of that name.'],
    ])
  })

  it('reports a bound row whose units differ, a repeated or global name, and a local constant outside any super-module', () => {
    const declared = [
      { name: 'k', units: 'second', value: '3' },
      { name: 'k', units: 'second', value: '4' },
      { name: 'g', units: 'dimensionless', value: '1' },
    ]
    const { nodes, edges } = segments({ declared })
    nodes.find((node) => node.id === 'dndnode_0').data.variables.push({ name: 'g', type: 'global_constant', units: 'dimensionless' }, local('z'))
    const errors = expandHierarchy(nodes, edges).errors.map((error) => [error.kind, error.severity, error.message])
    expect(errors).toEqual(
      expect.arrayContaining([
        ['localConstantDeclaration', 'error', 'Super-module "segment" declares local constant "k" more than once.'],
        ['localConstantDeclaration', 'error', 'Super-module "segment" declares local constant "g", which is a global constant’s name.'.replace('’', "'")],
        ['localConstantUnits', 'error', '"seg1/p" variable "k" is in dimensionless, but local constant "k" of "segment" is in second.'],
        ['unknownLocalConstant', 'error', '"a" variable "z" is a local constant, but "a" is in no super-module.'],
      ])
    )
    expect(errors.filter(([kind]) => kind === 'localConstantDeclaration')).toHaveLength(2)
  })

  it('reports a CellML parameter name a local constant’s takes', () => {
    const { nodes, edges } = segments()
    nodes.find((node) => node.id === 'dndnode_0').data.variables.push(constant('k_seg1', '1'))
    const clash = expandHierarchy(nodes, edges).errors.find((error) => error.kind === 'parameterNameClash')
    expect(clash).toMatchObject({ convention: 'cellml', severity: 'error', message: expect.stringContaining('named "k_seg1"') })
  })

  it('warns of an override of a local constant that is no longer declared', () => {
    const { nodes, edges } = segments({ seg1: { '@': { k: { value: '2' }, gone: { value: '1' } } } })
    expect(expandHierarchy(nodes, edges).errors).toEqual([
      expect.objectContaining({ kind: 'orphanedOverride', severity: 'warning', message: expect.stringContaining('"@" local constant "gone"') }),
    ])
    expect(overridesOf('dndnode_1', nodes)).toEqual([
      { key: '@', path: '@', variable: 'k', value: '2', isOrphaned: false },
      { key: '@', path: '@', variable: 'gone', value: '1', isOrphaned: true },
    ])
  })

  it('turns bound rows into constants for circulatory_autogen, leaving unbound ones', () => {
    const rows = [constant('R', '1'), { ...local('k'), value: '2', localConstant: { owner: 'seg1' } }, local('z')]
    expect(asConstants(rows)).toEqual([constant('R', '1'), { ...local('k'), type: 'constant', value: '2' }, local('z')])
    expect(asConstants(rows, (row) => (row.name === 'z' ? '9' : undefined))[2]).toEqual({ ...local('z'), type: 'constant', value: '9' })
  })

  it('checks a new name against the super-module’s and the global constants', () => {
    const options = { declarations: [{ name: 'k' }], globalNames: ['g'] }
    expect(localConstantNameProblem('', options)).toMatch(/needs a name/)
    expect(localConstantNameProblem('1x', options)).toMatch(/letters, digits/)
    expect(localConstantNameProblem('k', options)).toMatch(/already a local constant/)
    expect(localConstantNameProblem('g', options)).toMatch(/global constant/)
    expect(localConstantNameProblem('m', options)).toBeNull()
  })
})

describe('writing and showing local constants', () => {
  it('writes this super instance’s value as its override under @, and the super-module’s as the declaration', () => {
    const { nodes, edges } = twoLevel()
    const { origin } = expandHierarchy(nodes, edges)
    const find = findNodeIn(nodes)
    expect(localConstantTargetOf('dndnode_1/bed/cap', 'instance', origin, find)).toEqual({ nodeId: 'dndnode_1', field: 'overrides', key: 'bed/@' })
    expect(localConstantTargetOf('dndnode_1/bed/cap', 'supermodule', origin, find)).toEqual({ nodeId: 'sm_2', field: 'supermodule' })
    // A module of a super-module edited on its own.
    expect(localConstantTargetOf('sm_2~cap', 'instance', origin, find)).toEqual({ nodeId: 'sm_2', field: 'supermodule' })
  })

  it('chips a bound row local, or overridden with the value it has without this super instance', () => {
    const { nodes, edges } = segments()
    const model = expandHierarchy(nodes, edges)
    const find = findNodeIn(nodes)
    expect(provenanceOf('dndnode_1/p', model, find).get('k')).toMatchObject({ chip: 'overridden', isLocal: true, value: '2', inherited: '3' })
    expect(provenanceOf('dndnode_2/p', model, find).get('k')).toMatchObject({ chip: 'local', isOverridden: false, value: '3' })
    expect(provenanceOf('dndnode_2/p', model, find).get('R').chip).toBe('default')
  })
})

describe('removing a local constant', () => {
  it('retypes its rows to constants and turns each override of it into one per row, so the model keeps its values', () => {
    const { nodes, edges } = segments()
    const before = valuesOf(expandHierarchy(nodes, edges))
    const { changes, bound } = planLocalConstantRemoval(nodes, 'sm_1', 'k')
    expect(bound.map((node) => node.id)).toEqual(['sm_1~p', 'sm_1~q'])
    expect(changes.get('sm_1').supermodule.localConstants).toEqual([])
    expect(changes.get('sm_1~p').variables.find((row) => row.name === 'k')).toEqual({ ...local('k'), type: 'constant', value: '3' })
    expect(changes.get('dndnode_1').overrides).toEqual({ p: { k: { value: '2' } }, q: { k: { value: '2' } } })
    const after = nodes.map((node) => (changes.has(node.id) ? { ...node, data: { ...node.data, ...changes.get(node.id) } } : node))
    const expansion = expandHierarchy(after, edges)
    expect(expansion.errors).toEqual([])
    expect(valuesOf(expansion)).toEqual(before)
  })

  it('turns an outer super instance’s override of a nested one’s local constant into one of its rows', () => {
    const { nodes, edges } = twoLevel({ outer: { 'bed/@': { c: { value: '7' } } } })
    const { changes } = planLocalConstantRemoval(nodes, 'sm_2', 'c')
    expect(changes.get('dndnode_1').overrides).toEqual({ 'bed/cap': { c: { value: '7' } } })
  })

  it('drops an override of a bound row, which the local constant won over, rather than let it take effect', () => {
    const { nodes, edges } = segments({ seg1: { '@': { k: { value: '2' } }, p: { k: { value: '9' }, R: { value: '4' } } } })
    nodes.find((node) => node.id === 'dndnode_2').data.overrides = { q: { k: { value: '8' } } }
    const before = valuesOf(expandHierarchy(nodes, edges))
    const { changes } = planLocalConstantRemoval(nodes, 'sm_1', 'k')
    expect(changes.get('dndnode_1').overrides).toEqual({ p: { k: { value: '2' }, R: { value: '4' } }, q: { k: { value: '2' } } })
    expect(changes.get('dndnode_2').overrides).toEqual({})
    const after = nodes.map((node) => (changes.has(node.id) ? { ...node, data: { ...node.data, ...changes.get(node.id) } } : node))
    expect(valuesOf(expandHierarchy(after, edges))).toEqual(before)
  })
})

describe('un-nesting a super instance with local constants', () => {
  it('bakes them into the moved rows as constants with the values they had for it', () => {
    const { nodes, edges } = segments()
    const before = valuesOf(expandHierarchy(nodes, edges))
    expect(unnestProblem(nodes, 'dndnode_1')).toBeNull()
    const after = unnest(nodes, edges, 'dndnode_1')
    expect(after.problems).toEqual([])
    const moved = after.nodes.filter((node) => node.data.scope === null && ['p', 'q'].includes(node.data.name))
    expect(moved.map((node) => node.data.variables.find((row) => row.name === 'k'))).toEqual([
      { ...local('k'), type: 'constant', value: '2' },
      { ...local('k'), type: 'constant', value: '2' },
    ])
    const expansion = expandHierarchy(after.nodes, after.edges)
    expect(expansion.errors).toEqual([])
    expect(valuesOf(expansion)).toEqual(renamedValues(before, 'seg1__', ''))
  })

  it('turns an outer override of a nested super instance’s local constants into overrides of the moved rows', () => {
    const { nodes, edges } = twoLevel({ inner: { '@': { c: { value: '5' } } }, outer: { 'bed/@': { c: { value: '7' } } } })
    expect(valuesOf(expandHierarchy(nodes, edges))['leg__bed__cap.c']).toBe('7')
    const after = unnest(nodes, edges, 'sm_1~bed')
    expect(after.problems).toEqual([])
    const cap = after.nodes.find((node) => node.data.scope === 'sm_1' && node.data.name === 'cap')
    expect(cap.data.variables).toEqual([{ ...local('c'), type: 'constant', value: '5' }])
    expect(after.nodes.find((node) => node.id === 'dndnode_1').data.overrides).toEqual({ [cap.data.localId]: { c: { value: '7' } } })
    expect(valuesOf(expandHierarchy(after.nodes, after.edges))['leg__cap.c']).toBe('7')
  })

  it('drops an outer override of a bound row, which the local constant won over, and an outer one of constants none binds', () => {
    const { nodes, edges } = twoLevel({ inner: { '@': { c: { value: '5' } } }, outer: { 'bed/cap': { c: { value: '9' } }, 'bed/@': { gone: { value: '1' } } } })
    const before = valuesOf(expandHierarchy(nodes, edges))
    const after = unnest(nodes, edges, 'sm_1~bed')
    expect(after.nodes.find((node) => node.id === 'dndnode_1').data.overrides).toEqual({})
    const values = valuesOf(expandHierarchy(after.nodes, after.edges))
    expect(values['leg__cap.c']).toBe(before['leg__bed__cap.c'])
  })
})

describe('nesting modules bound to local constants', () => {
  it('is refused, as the new super-module would declare none of them', () => {
    const { nodes } = segments()
    expect(nestProblem(nodes, ['sm_1~p'])).toMatch(/"p" uses a local constant/)
  })
})

describe('dropping the overrides a binding leaves inert', () => {
  it('drops every super instance’s override of a newly bound row, nested paths included, and counts them', () => {
    const { nodes } = twoLevel({ outer: { 'bed/cap': { c: { value: '7' } }, art: { R: { value: '2' } } }, inner: { cap: { c: { value: '5' }, R: { value: '4' } } } })
    const cap = nodes.find((node) => node.id === 'sm_2~cap')
    cap.data.variables = [constant('R', '1'), constant('c', '1')]
    const { changes, count } = planRetypeBinding(nodes, cap, [constant('R', '1'), local('c')])
    expect(count).toBe(2)
    expect(changes.get('dndnode_1').overrides).toEqual({ art: { R: { value: '2' } } })
    expect(changes.get('sm_1~bed').overrides).toEqual({ cap: { R: { value: '4' } } })
  })

  it('plans nothing when no row becomes bound: already bound, not declared, or not in a super-module', () => {
    const { nodes } = segments({ seg1: { p: { k: { value: '9' } } } })
    const p = nodes.find((node) => node.id === 'sm_1~p')
    expect(planRetypeBinding(nodes, p, p.data.variables).count).toBe(0)
    p.data.variables = [constant('R', '1'), constant('k', '1')]
    expect(planRetypeBinding(nodes, p, [local('R'), constant('k', '1')]).changes.size).toBe(0)
    const a = nodes.find((node) => node.id === 'dndnode_0')
    expect(planRetypeBinding(nodes, a, [local('R')]).count).toBe(0)
    expect(planShadowedOverrideRemoval(nodes, 'sm_1', new Map()).changes.size).toBe(0)
  })
})
