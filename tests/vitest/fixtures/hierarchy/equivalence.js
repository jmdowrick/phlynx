/**
 * Nested graphs paired with the flat graphs they stand for, built by hand from the bundled module configs and CellML
 * (BG.json, heart.json): each nested graph should expand to a model that exports as its flat graph does.
 *
 * Each fixture takes a module factory (moduleFactory) and returns `{ nested, flat }`, each `{ nodes, edges }`.
 */
import { readFileSync } from 'node:fs'

import { buildInstance } from '../../../../src/services/import/buildWorkflow.js'
import { analyzeMathXml } from '../../../../src/services/math/analyzeMath.js'
import { reconcileRows } from '../../../../src/services/math/reconcileRows.js'
import { MAIN_NODE_TYPE } from '../../../../src/utils/constants.js'
import { nodeIdOf } from '../../../../src/utils/hierarchy.js'
import { isBlank } from '../../../../src/utils/variables.js'
import { processCellMLData } from '../../../../src/utils/cellml.js'
import { connect, exposed, exposures, superInstance, supermodule } from './graph.js'

const readAsset = (file) => readFileSync(`src/assets/${file}`, 'utf8')

/**
 * Loads the bundled units, BG and heart modules into a library store.
 *
 * @param {Object} store - A libraryStore.
 */
export function loadBundledLibrary(store) {
  for (const [file, text] of [
    ['units.cellml', readAsset('units/units.cellml')],
    ['BG_modules.cellml', readAsset('modules/BG_modules.cellml')],
    ['heart_modules.cellml', readAsset('modules/heart_modules.cellml')],
  ]) {
    const result = processCellMLData(text)
    if (result.type !== 'success') throw new Error(`Could not load ${file}.`)
    if (result.components?.length) store.addMathFile(file, result.components)
    if (result.units.count > 0) store.addUnitsFile({ componentFile: file, model: result.units.model })
  }
  store.addConfigFile('BG.json', JSON.parse(readAsset('module_configs/BG.json')))
  store.addConfigFile('heart.json', JSON.parse(readAsset('module_configs/heart.json')))
}

/**
 * Makes a factory of module nodes built as a dropped module is, each with its own copy of the ports, every value left
 * blank set to 1 and every global constant given a value, so the model exports.
 *
 * @param {Object} store - A libraryStore with the bundled library loaded.
 * @returns {(localId: string, name: string, moduleRef: string, options?: {scope?: string|null, values?: Object}) => Object}
 */
export function moduleFactory(store) {
  return (localId, name, moduleRef, { scope = null, values = {} } = {}) => {
    const moduleData = store.availableModules.get(moduleRef)
    if (!moduleData) throw new Error(`No bundled module "${moduleRef}".`)
    const node = buildInstance(
      nodeIdOf(scope, localId),
      name,
      MAIN_NODE_TYPE,
      { ...moduleData, ports: JSON.parse(JSON.stringify(moduleData.ports)) },
      [],
      { x: 0, y: 0 },
      store.getMathAnalysis(moduleData.mathRef),
      store.getMathDefaults(moduleData.mathRef)
    )
    node.data.scope = scope
    node.data.localId = localId
    node.data.variables = node.data.variables.map((row) => {
      if (row.type === 'global_constant') store.assignGlobalConstant(row.name, '1', row.units, 'test')
      if (row.name in values) return { ...row, value: values[row.name] }
      return isBlank(row.value) && row.type !== 'variable' && row.type !== 'global_constant' ? { ...row, value: '1' } : row
    })
    return node
  }
}

/** The (portType, label) group's slot-th port of a node. */
const portAt = (node, portType, label, slot = 0) => node.data.ports.filter((p) => p.portType === portType && p.label === label)[slot]

/**
 * Two terminals feeding a venous super instance, whose ivc sums their flows through the bundled venous vp's
 * ['sum', 'True'] entrance.
 */
export function venousFanIn(make) {
  const ivc = make('ivc', 'ivc', 'venous:vp', { scope: 'sm_1' })
  const sm = supermodule('sm_1', 'venous_return', { submoduleOrder: ['ivc'] })
  const exposure = exposures('sm_1', [exposed('xp_in', 'ivc', 'entrance_ports', 'vessel_port')])
  const veins = superInstance({ nodes: [sm, ivc], edges: exposure }, 'dndnode_2', 'veins', 'sm_1')
  const termA = make('dndnode_0', 'term_a', 'terminal:pp')
  const termB = make('dndnode_1', 'term_b', 'terminal:pp')
  const nested = {
    nodes: [termA, termB, veins, sm, ivc],
    edges: [connect(termA, veins, { id: 'e0' }), connect(termB, veins, { id: 'e1' }), ...exposure],
  }

  const flatIvc = make('f2', 'veins__ivc', 'venous:vp')
  const [a, b] = [make('f0', 'term_a', 'terminal:pp'), make('f1', 'term_b', 'terminal:pp')]
  return { nested, flat: { nodes: [a, b, flatIvc], edges: [connect(a, flatIvc), connect(b, flatIvc)] } }
}

/**
 * Two super instances of one super-module, each multiplying its artery's flow by 2 into one of a flow sum's two inputs:
 * the child's Multiply and factor are read live through the exposed port.
 */
export function multiply(make) {
  const art = make('art', 'art', 'arterial_simple:vp', { scope: 'sm_1' })
  Object.assign(portAt(art, 'exit_ports', 'flow_port'), { multiportType: 'Multiply', multiplyFactor: 2 })
  const sm = supermodule('sm_1', 'source', { submoduleOrder: ['art'] })
  const exposure = exposures('sm_1', [exposed('xp_flow', 'art', 'exit_ports', 'flow_port')])
  const inner = { nodes: [sm, art], edges: exposure }
  const s1 = superInstance(inner, 'dndnode_0', 's1', 'sm_1')
  const s2 = superInstance(inner, 'dndnode_1', 's2', 'sm_1', { overrides: { art: { R: { value: '7' } } } })
  const mix = make('dndnode_2', 'mix', 'flow_sum_2:nn')
  const used = new Set()
  const nested = {
    nodes: [s1, s2, mix, sm, art],
    edges: [connect(s1, mix, { used, id: 'e0' }), connect(s2, mix, { used, id: 'e1' }), ...exposure],
  }

  const multiplied = (node) => {
    Object.assign(portAt(node, 'exit_ports', 'flow_port'), { multiportType: 'Multiply', multiplyFactor: 2 })
    return node
  }
  const f1 = multiplied(make('f0', 's1__art', 'arterial_simple:vp'))
  const f2 = multiplied(make('f1', 's2__art', 'arterial_simple:vp', { values: { R: '7' } }))
  const flatMix = make('f2', 'mix', 'flow_sum_2:nn')
  const flatUsed = new Set()
  return {
    nested,
    flat: { nodes: [f1, f2, flatMix], edges: [connect(f1, flatMix, { used: flatUsed }), connect(f2, flatMix, { used: flatUsed })] },
  }
}

/**
 * A heart in a super instance exposing its three entrance vessel_ports in order, fed in its svc and pulmonary slots as CA
 * pins them, and feeding an aorta.
 */
export function heartSlots(make) {
  const heart = make('heart', 'heart', 'heart:vp', { scope: 'sm_1' })
  const sm = supermodule('sm_1', 'cardiac', { submoduleOrder: ['heart'] })
  const exposure = exposures('sm_1', [
    exposed('xp_ivc', 'heart', 'entrance_ports', 'vessel_port', { slot: 0 }),
    exposed('xp_svc', 'heart', 'entrance_ports', 'vessel_port', { slot: 1 }),
    exposed('xp_pvn', 'heart', 'entrance_ports', 'vessel_port', { slot: 2 }),
    exposed('xp_aov', 'heart', 'exit_ports', 'vessel_port', { slot: 0 }),
  ])
  const cardiac = superInstance({ nodes: [sm, heart], edges: exposure }, 'dndnode_2', 'cardiac', 'sm_1', { overrides: { heart: { v_ivc: { value: '0' } } } })
  const svc = make('dndnode_0', 'venous_svc', 'venous:vp')
  const pvn = make('dndnode_1', 'pvn', 'venous:vp')
  const aorta = make('dndnode_3', 'aorta', 'arterial_simple:vp')
  const pin = (target, slot) => [{ targetPort: portAt(target, 'entrance_ports', 'vessel_port', slot), targetSlot: slot }]
  const used = new Set()
  const nested = {
    nodes: [svc, pvn, cardiac, aorta, sm, heart],
    edges: [
      connect(pvn, cardiac, { used, id: 'e0', stored: pin(cardiac, 2) }),
      connect(svc, cardiac, { used, id: 'e1', stored: pin(cardiac, 1) }),
      connect(cardiac, aorta, { used, id: 'e2' }),
      ...exposure,
    ],
  }

  const flatHeart = make('f2', 'cardiac__heart', 'heart:vp', { values: { v_ivc: '0' } })
  const [fs, fp, fa] = [make('f0', 'venous_svc', 'venous:vp'), make('f1', 'pvn', 'venous:vp'), make('f3', 'aorta', 'arterial_simple:vp')]
  const flatUsed = new Set()
  return {
    nested,
    flat: {
      nodes: [fs, fp, flatHeart, fa],
      edges: [
        connect(fp, flatHeart, { used: flatUsed, stored: pin(flatHeart, 2) }),
        connect(fs, flatHeart, { used: flatUsed, stored: pin(flatHeart, 1) }),
        connect(flatHeart, fa, { used: flatUsed }),
      ],
    },
  }
}

/**
 * An artery in a super instance whose outlet pressure, a boundary condition, meets a terminal's inlet pressure, also one:
 * nothing computes them, through the interface or not.
 */
export function bcOnlyThroughInterface(make) {
  const art = make('art', 'art', 'arterial_simple:vp', { scope: 'sm_1' })
  const sm = supermodule('sm_1', 'upstream', { submoduleOrder: ['art'] })
  const exposure = exposures('sm_1', [exposed('xp_out', 'art', 'exit_ports', 'vessel_port')])
  const up = superInstance({ nodes: [sm, art], edges: exposure }, 'dndnode_0', 'up', 'sm_1')
  const term = make('dndnode_1', 'term', 'terminal:pp')
  const flatArt = make('f0', 'up__art', 'arterial_simple:vp')
  const flatTerm = make('f1', 'term', 'terminal:pp')
  return {
    nested: { nodes: [up, term, sm, art], edges: [connect(up, term, { id: 'e0' }), ...exposure] },
    flat: { nodes: [flatArt, flatTerm], edges: [connect(flatArt, flatTerm)] },
  }
}

/**
 * Two levels: an aorta feeds leg (limb: art → bed), bed (capillary_bed: cap) drains through leg into a vein. leg's
 * outlet aliases bed's through via. bed sets cap's R_T, and leg sets it again, which wins, as well as art's R.
 */
export function twoLevel(make) {
  const cap = make('cap', 'cap', 'terminal:pp', { scope: 'sm_2' })
  const bedsm = supermodule('sm_2', 'capillary_bed', { submoduleOrder: ['cap'] })
  const bedExposure = exposures('sm_2', [exposed('xp_in', 'cap', 'entrance_ports', 'vessel_port'), exposed('xp_out', 'cap', 'exit_ports', 'vessel_port')])
  const art = make('art', 'art', 'arterial_simple:pv', { scope: 'sm_1' })
  const bed = superInstance({ nodes: [bedsm, cap], edges: bedExposure }, 'bed', 'bed', 'sm_2', { scope: 'sm_1', overrides: { cap: { R_T: { value: '2' } } } })
  const limb = supermodule('sm_1', 'limb', { submoduleOrder: ['art', 'bed'] })
  const exposure = [
    ...exposures('sm_1', [exposed('xp_a', 'art', 'entrance_ports', 'vessel_port'), exposed('xp_b', 'bed', 'exit_ports', 'vessel_port', { via: 'xp_out' })]),
    ...bedExposure,
  ]
  const store = [limb, art, bed, bedsm, cap]
  const leg = superInstance({ nodes: store, edges: exposure }, 'dndnode_1', 'leg', 'sm_1', { overrides: { 'bed/cap': { R_T: { value: '3' } }, art: { R: { value: '4' } } } })
  const aorta = make('dndnode_0', 'aorta', 'arterial_simple:pv')
  const vc = make('dndnode_2', 'vc', 'venous:vp')
  const used = new Set()
  const nested = {
    nodes: [aorta, leg, vc, ...store],
    edges: [connect(aorta, leg, { used, id: 'e0' }), connect(leg, vc, { used, id: 'e1' }), connect(art, bed), ...exposure],
  }

  const fAorta = make('f0', 'aorta', 'arterial_simple:pv')
  const fArt = make('f1', 'leg__art', 'arterial_simple:pv', { values: { R: '4' } })
  const fCap = make('f2', 'leg__bed__cap', 'terminal:pp', { values: { R_T: '3' } })
  const fVc = make('f3', 'vc', 'venous:vp')
  const flatUsed = new Set()
  return {
    nested,
    flat: {
      nodes: [fAorta, fArt, fCap, fVc],
      edges: [connect(fAorta, fArt, { used: flatUsed }), connect(fArt, fCap, { used: flatUsed }), connect(fCap, fVc, { used: flatUsed })],
    },
  }
}

/** One super-module, a single artery, used three times in series, each super instance setting its own R. */
export function threeInstances(make) {
  const a = make('a', 'a', 'arterial_simple:vp', { scope: 'sm_1' })
  const sm = supermodule('sm_1', 'segment', { submoduleOrder: ['a'] })
  const exposure = exposures('sm_1', [exposed('xp_in', 'a', 'entrance_ports', 'vessel_port'), exposed('xp_out', 'a', 'exit_ports', 'vessel_port')])
  const R = ['2', '3', '5']
  const inner = { nodes: [sm, a], edges: exposure }
  const segments = R.map((value, i) => superInstance(inner, `dndnode_${i}`, `seg${i + 1}`, 'sm_1', { overrides: { a: { R: { value } } } }))
  const used = new Set()
  const nested = {
    nodes: [...segments, sm, a],
    edges: [connect(segments[0], segments[1], { used, id: 'e0' }), connect(segments[1], segments[2], { used, id: 'e1' }), ...exposure],
  }
  const flat = R.map((value, i) => make(`f${i}`, `seg${i + 1}__a`, 'arterial_simple:vp', { values: { R: value } }))
  const flatUsed = new Set()
  return { nested, flat: { nodes: flat, edges: [connect(flat[0], flat[1], { used: flatUsed }), connect(flat[1], flat[2], { used: flatUsed })] } }
}

/**
 * A merge junction fed inside its super-module through its first vessel_port and, through its exposed second one,
 * from outside; the exposure edge exposing that port changes no internal coupling.
 *
 * @param {Function} make
 */
export function exposureLeavesInternalCouplings(make) {
  const p = make('p', 'p', 'arterial_simple:vp', { scope: 'sm_1' })
  const j = make('j', 'j', 'merge_junction_simple:vp', { scope: 'sm_1' })
  const sm = supermodule('sm_1', 'merge', { submoduleOrder: ['p', 'j'] })
  const exposure = exposures('sm_1', [
    exposed('xp_in', 'j', 'entrance_ports', 'vessel_port', { slot: 1 }),
    exposed('xp_out', 'j', 'exit_ports', 'vessel_port'),
  ])
  const internal = connect(p, j, { id: 'e_int' })
  const m = superInstance({ nodes: [sm, p, j], edges: exposure }, 'dndnode_1', 'm', 'sm_1')
  const q = make('dndnode_0', 'q', 'arterial_simple:vp')
  const out = make('dndnode_2', 'out', 'venous:vp')
  const nested = {
    nodes: [q, m, out, sm, p, j],
    edges: [connect(q, m, { id: 'e0' }), ...exposure, internal, connect(m, out, { id: 'e1' })],
  }

  const [fq, fp, fj, fo] = [
    make('f0', 'q', 'arterial_simple:vp'),
    make('f1', 'm__p', 'arterial_simple:vp'),
    make('f2', 'm__j', 'merge_junction_simple:vp'),
    make('f3', 'out', 'venous:vp'),
  ]
  // p takes j's first vessel_port, so q the second, as inside the super-module.
  const used = new Set()
  const intoJ = connect(fp, fj, { used })
  const fromQ = connect(fq, fj, { used })
  return {
    nested,
    flat: { nodes: [fq, fp, fj, fo], edges: [fromQ, intoJ, connect(fj, fo, { used })] },
  }
}

const HUB_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="hub">
  <component name="hub">
    <variable name="t" units="second" interface="public"/>
    <variable name="q" units="dimensionless" initial_value="q_init" interface="public"/>
    <variable name="q_init" units="dimensionless" initial_value="1" interface="public"/>
    <variable name="v_sum" units="per_second" interface="public"/>
    <variable name="u" units="dimensionless" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>q</ci></apply>
        <apply><minus/><ci>v_sum</ci></apply>
      </apply>
      <apply><eq/><ci>u</ci><ci>q</ci></apply>
    </math>
  </component>
</model>`
const BRANCH_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="branch">
  <component name="branch">
    <variable name="u" units="dimensionless" interface="public"/>
    <variable name="v" units="per_second" interface="public"/>
    <variable name="k" units="per_second" initial_value="0.5" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><ci>v</ci><apply><times/><ci>k</ci><ci>u</ci></apply></apply>
    </math>
  </component>
</model>`
const PER_SECOND = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="units">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
</model>`

/**
 * A hub draining through a Sum port into three super instances of one super-module, each a branch with its own k: a small
 * ODE that simulates quickly.
 *
 * @param {Object} store - A libraryStore; the hub and branch math are added to it.
 */
export function hubBranches(store) {
  // A node with rows built from the stored math, its port inputs typed as boundary conditions.
  const buildNode = (localId, name, mathRef, ports, { scope = null, values = {} } = {}) => {
    const portVariables = new Set(ports.flatMap((port) => port.variables))
    const rows = reconcileRows(analyzeMathXml(store.availableMath.get(mathRef)), [], { defaults: store.getMathDefaults(mathRef) }).map((row) => ({
      ...row,
      type: row.type === 'constant' && portVariables.has(row.name) ? 'boundary_condition' : row.type,
      ...(row.name in values && { value: values[row.name] }),
    }))
    return { id: nodeIdOf(scope, localId), type: MAIN_NODE_TYPE, data: { scope, localId, name, mathRef, variables: rows, ports } }
  }
  store.addUnitsFile({ componentFile: 'per_second.cellml', model: PER_SECOND })
  store.addMath('file:hub', HUB_XML)
  store.addMath('file:branch', BRANCH_XML)
  const hubPort = () => [{ portType: 'exit_ports', label: 'vessel', variables: ['v_sum', 'u'], multiportType: ['sum', 'True'] }]
  const branchPort = () => [{ portType: 'entrance_ports', label: 'vessel', variables: ['v', 'u'], multiportType: 'None' }]
  const k = ['0.5', '0.25', '0.125']

  const leaf = buildNode('leaf', 'leaf', 'file:branch', branchPort(), { scope: 'sm_1' })
  const sm = supermodule('sm_1', 'branch', { submoduleOrder: ['leaf'] })
  const exposure = exposures('sm_1', [exposed('xp', 'leaf', 'entrance_ports', 'vessel')])
  const hub = buildNode('dndnode_0', 'hub', 'file:hub', hubPort())
  const inner = { nodes: [sm, leaf], edges: exposure }
  const branches = k.map((value, i) => superInstance(inner, `dndnode_${i + 1}`, `b${i + 1}`, 'sm_1', { overrides: { leaf: { k: { value } } } }))
  const nested = {
    nodes: [hub, ...branches, sm, leaf],
    edges: [...branches.map((branch, i) => connect(hub, branch, { id: `e${i}` })), ...exposure],
  }

  const flatHub = buildNode('f0', 'hub', 'file:hub', hubPort())
  const flatBranches = k.map((value, i) => buildNode(`f${i + 1}`, `b${i + 1}__leaf`, 'file:branch', branchPort(), { values: { k: value } }))
  return { nested, flat: { nodes: [flatHub, ...flatBranches], edges: flatBranches.map((branch) => connect(flatHub, branch)) } }
}
