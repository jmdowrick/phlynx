// @vitest-environment happy-dom
import fs from 'node:fs'
import path from 'node:path'

import JSZip from 'jszip'
import Papa from 'papaparse'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

// Exporting and re-importing through libcellml takes seconds per test on CI.
vi.setConfig({ testTimeout: 120000 })

const notified = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }))
vi.mock('../../../src/utils/notify', () => ({ notify: notified }))

const { generateExportZip } = await import('../../../src/services/export/ca.js')
const { planCaPairing } = await import('../../../src/services/export/caPairing.js')
const { simulateCaPairing } = await import('../../../src/services/export/caSimulate.js')
const { buildWorkflowGraph } = await import('../../../src/services/import/buildWorkflow.js')
const { foldVariantPorts } = await import('../../../src/services/caVariants.js')
const { useLibraryStore } = await import('../../../src/stores/libraryStore.js')
const { restorePorts, restoreVariables } = await import('../../../src/utils/config.js')
const { slotOf } = await import('../../../src/utils/edges.js')
const { applyParametersToNodes } = await import('../../../src/utils/parameters.js')
const { generateFlattenedModel } = await import('../../../src/utils/cellml.js')
const { compareCanonical } = await import('../../../src/services/testing/modelCompare.js')
const { loadBundledLibrary, moduleFactory } = await import('../fixtures/hierarchy/equivalence.js')
const { connect } = await import('../fixtures/hierarchy/graph.js')
const { arrayFromExport, connect: coupled, moduleArrayRows } = await import('../fixtures/ca/workspace.js')

const USER_MATH_REF = 'User_modules.cellml:pv_simple_copy_type'
// The same math in a file CA wouldn't find, which the export writes as USER_MATH_REF's.
const PLAIN_MATH_REF = 'User.cellml:pv_simple_copy_type'

/**
 * Lists an exported zip's files.
 *
 * @param {Blob} blob
 * @returns {Promise<Object>} Each file's text by name.
 */
async function readZip(blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir)
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await zip.file(name).async('string')])))
}

const exported = async (nodes, edges, library) => readZip(await generateExportZip('model', nodes, edges, library))
const moduleArray = (files) => moduleArrayRows(files['model_module_array.json'])
const moduleConfig = (files) => JSON.parse(files['modules/model_module_config.json'])

/**
 * A library with the bundled modules and a copy of arterial_simple:pv's math under another component, for an instance
 * saved to new math.
 *
 * @param {string} [mathRef] - Where the copy is, USER_MATH_REF by default.
 * @returns {Object}
 */
function bundledLibrary(mathRef = USER_MATH_REF) {
  const library = useLibraryStore()
  loadBundledLibrary(library)
  const math = library.availableMath.get('BG_modules.cellml:pv_simple_type').replace('name="pv_simple_type"', 'name="pv_simple_copy_type"')
  library.addMath(mathRef, math)
  return library
}

/**
 * A workspace with what the edge connection dialog can leave: a split junction's first branch deleted, a flow sum's
 * second slot chosen, a label two connected modules share left uncoupled, a source entrance port coupled to a target
 * general port with fewer variables, an edited variable, and an instance on new math. a and d are as the library
 * gives them.
 *
 * @param {Object} library
 * @param {string} [mathRef] - The new math, USER_MATH_REF by default.
 * @returns {{ nodes: Array, edges: Array }}
 */
function customisedWorkspace(library, mathRef = USER_MATH_REF) {
  const make = moduleFactory(library)
  const a = make('n_a', 'a', 'arterial_simple:vp')
  const split = make('n_split', 'split', 'split_junction:pv')
  const b = make('n_b', 'b', 'arterial_simple:pv')
  const c = make('n_c', 'c', 'arterial_simple:pv')
  const d = make('n_d', 'd', 'arterial_simple:pv')
  const e = make('n_e', 'e', 'arterial_simple:pv')
  const sum = make('n_sum', 'sum', 'flow_sum_2:nn')

  // Instance port edits, as the dialog writes them: b's entrance ctrl, c's general ctrl and an entrance flow_port.
  b.data.ports = [...b.data.ports, { portType: 'entrance_ports', label: 'ctrl', variables: ['u_in', 'v'], multiportType: 'None' }]
  c.data.ports = [
    ...c.data.ports,
    { portType: 'general_ports', label: 'ctrl', variables: ['u_in'], multiportType: 'None' },
    { portType: 'entrance_ports', label: 'flow_port', variables: ['v'], multiportType: 'None' },
  ]
  // A variable edited on one instance (#689): c's R a global constant.
  c.data.variables = c.data.variables.map((row) => (row.name === 'R' ? { ...row, type: 'global_constant' } : row))
  library.assignGlobalConstant('R', '1', 'Js_per_m6', 'test')
  // e saved to new math.
  e.data.mathRef = mathRef

  const port = (node, portType, label, slot = 0) =>
    node.data.ports.indexOf(node.data.ports.filter((p) => p.portType === portType && p.label === label)[slot])
  const edges = [
    connect(a, split),
    coupled(split, b, [[port(split, 'exit_ports', 'vessel_port', 1), port(b, 'entrance_ports', 'vessel_port')]]),
    coupled(a, sum, [[port(a, 'exit_ports', 'flow_port'), port(sum, 'entrance_ports', 'flow_port', 1)]]),
    coupled(b, c, [
      [port(b, 'exit_ports', 'vessel_port'), port(c, 'entrance_ports', 'vessel_port')],
      [port(b, 'entrance_ports', 'ctrl'), port(c, 'general_ports', 'ctrl')],
    ]),
    connect(c, d),
    connect(d, e),
  ]
  return { nodes: [a, split, b, c, d, e, sum], edges }
}

/** Each edge's couplings as its modules' names and its ports' types, labels, slots and variables, sorted. */
function couplingsOf({ nodes, edges }) {
  const nameOf = new Map(nodes.map((node) => [node.id, node.data.name]))
  const end = (port, slot) => `${port.portType}:${port.label}:${slot}[${port.variables}]`
  return edges
    .map((edge) => {
      const couplings = edge.data.couplings.map((c) => `${end(c.sourcePort, c.sourceSlot)} > ${end(c.targetPort, c.targetSlot)}`)
      return `${nameOf.get(edge.source)} > ${nameOf.get(edge.target)}: ${couplings.sort().join(', ')}`
    })
    .sort()
}

/** Each node's ports, as a config writes them, and config-relevant rows, by name. */
function instancesOf(nodes) {
  return Object.fromEntries(
    nodes.map((node) => [
      node.data.name,
      { moduleRef: node.data.moduleRef, mathRef: node.data.mathRef, ports: restorePorts(node.data.ports), rows: restoreVariables(node.data.variables).map(String).sort() },
    ])
  )
}

/**
 * Pairs the exported module array's slots as CA would, and lists them as the workspace's couplings: each port by the
 * type, label and slot its instance has here.
 *
 * @param {Object} files
 * @returns {Array<string>}
 */
function caCouplingsOf(files) {
  const array = arrayFromExport(files['model_module_array.json'], moduleConfig(files))
  const { rows: nodes, byId } = array
  const { pairs, errors } = simulateCaPairing(array)
  expect(errors.filter((error) => error.kind !== 'misaligned')).toEqual([])
  const folded = new Map(nodes.map((node) => [node.id, foldVariantPorts(node.data.ports)]))
  const end = (id, index) => {
    const { ports, of } = folded.get(id)
    const port = of.get(byId.get(id).data.ports[index])
    return `${port.portType}:${port.label}:${slotOf(ports, port)}[${port.variables}]`
  }
  const byEdge = new Map()
  for (const { edge, source, target } of pairs) {
    const key = `${edge.source} > ${edge.target}`
    if (!byEdge.has(key)) byEdge.set(key, [])
    byEdge.get(key).push(`${end(edge.source, source)} > ${end(edge.target, target)}`)
  }
  return [...byEdge].map(([key, list]) => `${key}: ${list.sort().join(', ')}`).sort()
}

/**
 * Imports an export into a fresh library holding the bundled modules, as the module array import does.
 *
 * @param {Object} files
 * @param {Object} [options]
 * @param {boolean} [options.withoutBases] - Leave out of the library the modules the export's variants stand in for,
 *   as for a module of the user's own from another session.
 * @returns {{ nodes: Array, edges: Array, library: Object, conflicts: Array<string> }}
 */
function reimport(files, { withoutBases = false } = {}) {
  setActivePinia(createPinia())
  const library = bundledLibrary()
  if (withoutBases) {
    for (const entry of moduleConfig(files)) {
      if (entry.phlynx_base_subtype) library.availableModules.delete(`${entry.module_type}:${entry.phlynx_base_subtype}`)
    }
  }
  library.addConfigFile('model_module_config.json', moduleConfig(files))
  const { pendingInstances, pendingEdges, conflicts } = buildWorkflowGraph(
    moduleArray(files),
    library.availableModules,
    library.getMathAnalysis,
    [],
    null,
    library.getMathDefaults,
    { caRules: true, variants: library.caVariants }
  )
  return { nodes: pendingInstances, edges: pendingEdges, library, conflicts }
}

describe('the CA export of a customised workspace', () => {
  let library

  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    library = bundledLibrary()
  })

  it('gives CA the pairing the workspace holds, warning of nothing', async () => {
    const workspace = customisedWorkspace(library)
    const files = await exported(workspace.nodes, workspace.edges, library)
    expect(caCouplingsOf(files)).toEqual(couplingsOf(workspace))
    expect(notified.warning).not.toHaveBeenCalled()
    expect(notified.error).not.toHaveBeenCalled()
  })

  it("keeps the module's subtype for an instance as the library gives it, and gives each other its own variant", async () => {
    const workspace = customisedWorkspace(library)
    const files = await exported(workspace.nodes, workspace.edges, library)
    const subtypes = Object.fromEntries(moduleArray(files).map((row) => [row.name, row.module_subtype]))
    expect(subtypes).toMatchObject({ a: 'vp', d: 'pv' })
    for (const name of ['split', 'b', 'c', 'e', 'sum']) expect(subtypes[name]).toMatch(/^[a-z_]+__[0-9a-z]{8}$/)
    expect(new Set(Object.values(subtypes)).size).toBe(7)

    const entries = moduleConfig(files)
    const refs = entries.map((entry) => `${entry.module_type}:${entry.module_subtype}`)
    expect(refs).toEqual(expect.arrayContaining(['arterial_simple:vp', 'arterial_simple:pv']))
    for (const entry of entries.filter((entry) => entry.module_subtype.includes('__'))) {
      expect(entry.module_subtype.startsWith(`${entry.phlynx_base_subtype}__`)).toBe(true)
    }
    expect(notified.info).toHaveBeenCalledWith(expect.objectContaining({ title: 'Module Variants' }))
  })

  it("writes each instance's own variables and math, so CA reads no other instance's (#689)", async () => {
    const workspace = customisedWorkspace(library)
    const a = workspace.nodes.find((node) => node.data.name === 'a')
    a.data.variables = a.data.variables.map((row) => (row.name === 'C' ? { ...row, units: 'J_per_m3' } : row))
    const files = await exported(workspace.nodes, workspace.edges, library)
    const entryOf = (name) => {
      const row = moduleArray(files).find((r) => r.name === name)
      return moduleConfig(files).find((entry) => entry.module_type === row.module_type && entry.module_subtype === row.module_subtype)
    }
    expect(entryOf('a').variables_and_units).toContainEqual(['C', 'J_per_m3', 'access', 'constant'])
    expect(entryOf('c').variables_and_units).toContainEqual(['R', 'Js_per_m6', 'access', 'global_constant'])
    expect(entryOf('d').variables_and_units).toContainEqual(['R', 'Js_per_m6', 'access', 'constant'])
    expect(entryOf('e')).toMatchObject({ component_file: 'User_modules.cellml', component_type: 'pv_simple_copy_type' })
  })

  it('writes a component once however many variants use it, and the new math of a variant on it', async () => {
    const workspace = customisedWorkspace(library)
    const files = await exported(workspace.nodes, workspace.edges, library)
    expect(files['modules/BG_modules.cellml'].match(/<component name="pv_simple_type">/g)).toHaveLength(1)
    expect(files['modules/User_modules.cellml']).toContain('<component name="pv_simple_copy_type">')
  })

  it('names the variants the same on every export, whatever the order of the nodes', async () => {
    const workspace = customisedWorkspace(library)
    const first = await exported(workspace.nodes, workspace.edges, library)
    const again = await exported([...workspace.nodes].reverse(), [...workspace.edges].reverse(), library)
    const subtypes = (files) => Object.fromEntries(moduleArray(files).map((row) => [row.name, row.module_subtype]))
    expect(subtypes(again)).toEqual(subtypes(first))
    expect(moduleConfig(again).map((entry) => entry.module_subtype).sort()).toEqual(moduleConfig(first).map((entry) => entry.module_subtype).sort())
  })

  it('writes the parameters as without variants', async () => {
    const workspace = customisedWorkspace(library)
    const files = await exported(workspace.nodes, workspace.edges, library)
    const plain = workspace.nodes.map((node) => ({ ...node, data: { ...node.data, ports: [] } }))
    const without = await exported(plain, [], library)
    const rows = (files) => Papa.parse(files['model_parameters.csv'], { header: true, skipEmptyLines: true }).data.map(JSON.stringify).sort()
    expect(rows(files)).toEqual(rows(without))
  })

  it('gives back the same pairing, ports, rows and math when imported again, folding each variant onto its module', async () => {
    const workspace = customisedWorkspace(library)
    const files = await exported(workspace.nodes, workspace.edges, library)
    const imported = reimport(files)
    expect(imported.conflicts).toEqual([])
    expect(couplingsOf(imported)).toEqual(couplingsOf(workspace))
    expect(instancesOf(imported.nodes)).toEqual(instancesOf(workspace.nodes))
    expect([...imported.library.availableModules.keys()].filter((ref) => ref.includes('__'))).toEqual([])
  })

  it('exports a workspace imported from its export as before, without stacking variant names', async () => {
    const workspace = customisedWorkspace(library)
    const files = await exported(workspace.nodes, workspace.edges, library)
    const imported = reimport(files)
    const again = await exported(imported.nodes, imported.edges, imported.library)
    expect(again['model_module_array.json']).toBe(files['model_module_array.json'])
    expect(moduleConfig(again)).toEqual(moduleConfig(files))
  })

  it('gives back a workspace PhLynx generates the same CellML from', async () => {
    const workspace = customisedWorkspace(library)
    const files = await exported(workspace.nodes, workspace.edges, library)
    const cellmlOf = async ({ nodes, edges }, store) =>
      (await generateFlattenedModel(nodes, edges, store, [], { check: false, allowBcOnly: true })).text()
    const before = await cellmlOf(workspace, library)

    const imported = reimport(files)
    const rows = Papa.parse(files['model_parameters.csv'], { header: true, skipEmptyLines: true }).data
    const { variablesById } = applyParametersToNodes(imported.nodes, rows)
    for (const node of imported.nodes) if (variablesById.has(node.id)) node.data.variables = variablesById.get(node.id)
    for (const [name, constant] of library.globalVariables) imported.library.assignGlobalConstant(name, constant.value, constant.units, constant.data_reference)
    imported.library.addMath(USER_MATH_REF, library.availableMath.get(USER_MATH_REF))

    const result = compareCanonical(before, await cellmlOf(imported, imported.library), { nameByConnection: ['generated_summations', 'generated_multiplications'] })
    expect(result.differences).toEqual([])
    expect(result.equal).toBe(true)
  })

  it("writes the library's own entry for a module only variants use, which the import gives the library", async () => {
    const workspace = customisedWorkspace(library)
    const a = workspace.nodes.find((node) => node.data.name === 'a')
    a.data.variables = a.data.variables.map((row) => (row.name === 'C' ? { ...row, units: 'J_per_m3' } : row))
    const files = await exported(workspace.nodes, workspace.edges, library)
    expect(moduleArray(files).find((row) => row.name === 'a').module_subtype).toMatch(/^vp__/)

    setActivePinia(createPinia())
    const fresh = useLibraryStore()
    fresh.addConfigFile('model_module_config.json', moduleConfig(files))
    const original = library.availableModules.get('arterial_simple:vp')
    const module = fresh.availableModules.get('arterial_simple:vp')
    expect(restoreVariables(module.variables)).toEqual(restoreVariables(original.variables))
    expect(module.mathRef).toBe(original.mathRef)
    expect(restorePorts(module.ports)).toEqual(restorePorts(original.ports))
    expect([...fresh.availableModules.keys()].filter((ref) => ref.startsWith('arterial_simple:vp'))).toEqual(['arterial_simple:vp'])
  })

  it('folds a variant back into the module it stands in for when the file holds no entry for that module', async () => {
    const workspace = customisedWorkspace(library)
    const files = await exported(workspace.nodes, workspace.edges, library)
    const variants = moduleConfig(files).filter((entry) => !(entry.module_type === 'split_junction' && !entry.phlynx_base_subtype))
    setActivePinia(createPinia())
    const fresh = useLibraryStore()
    fresh.addConfigFile('model_module_config.json', variants)
    const module = fresh.availableModules.get('split_junction:pv')
    expect(restorePorts(module.ports)).toEqual(restorePorts(library.availableModules.get('split_junction:pv').ports))
  })

  it('gives back the same pairing, ports, rows and library modules imported into a library without the modules the variants stand in for', async () => {
    const workspace = customisedWorkspace(library)
    const files = await exported(workspace.nodes, workspace.edges, library)
    const imported = reimport(files, { withoutBases: true })
    expect(imported.conflicts).toEqual([])
    expect(couplingsOf(imported)).toEqual(couplingsOf(workspace))
    expect(instancesOf(imported.nodes)).toEqual(instancesOf(workspace.nodes))
    // The modules only variants use, which the export writes as the library holds them.
    const written = new Set(moduleArray(files).map((row) => `${row.module_type}:${row.module_subtype}`))
    const variantOnly = [...new Set(workspace.nodes.map((node) => node.data.moduleRef))].filter((ref) => !written.has(ref))
    expect(variantOnly).toEqual(['split_junction:pv', 'flow_sum_2:nn'])
    for (const ref of variantOnly) {
      const [before, after] = [library.availableModules.get(ref), imported.library.availableModules.get(ref)]
      expect({ ref, mathRef: after.mathRef, variables: restoreVariables(after.variables) }).toEqual({ ref, mathRef: before.mathRef, variables: restoreVariables(before.variables) })
    }

    const again = await exported(imported.nodes, imported.edges, imported.library)
    expect(again['model_module_array.json']).toBe(files['model_module_array.json'])
    expect(again['modules/model_module_config.json']).toBe(files['modules/model_module_config.json'])
  })

  it("names the variants the same on export after import, where an instance's math is in a file CA wouldn't find", async () => {
    setActivePinia(createPinia())
    const plain = bundledLibrary(PLAIN_MATH_REF)
    const workspace = customisedWorkspace(plain, PLAIN_MATH_REF)
    const files = await exported(workspace.nodes, workspace.edges, plain)
    expect(moduleConfig(files).find((entry) => entry.component_type === 'pv_simple_copy_type').component_file).toBe('User_modules.cellml')

    const imported = reimport(files)
    const again = await exported(imported.nodes, imported.edges, imported.library)
    expect(again['model_module_array.json']).toBe(files['model_module_array.json'])
    expect(moduleConfig(again)).toEqual(moduleConfig(files))
  })
})

describe('the CA export of a CA model imported as it is', () => {
  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  /**
   * Imports circulatory_autogen's FinalModel module array (240 modules, origin/master a9061f7f), as PhLynx does.
   *
   * @param {Object} library
   * @returns {{ nodes: Array, edges: Array }}
   */
  function finalModel(library) {
    const text = fs.readFileSync(path.resolve(process.cwd(), 'tests/resources/ca/FinalModel_module_array.csv'), 'utf8')
    const words = (value) => (value ?? '').trim().split(/\s+/).filter(Boolean).join(' ')
    const rows = Papa.parse(text, { header: true, skipEmptyLines: true, transformHeader: (header) => header.trim() }).data.map((row) => ({
      name: row.name.trim(),
      module_type: row.vessel_type.trim(),
      module_subtype: row.BC_type.trim(),
      inp_instances: words(row.inp_vessels),
      out_instances: words(row.out_vessels),
    }))
    const { pendingInstances, pendingEdges, conflicts } = buildWorkflowGraph(rows, library.availableModules, library.getMathAnalysis, [], null, library.getMathDefaults, { caRules: true })
    expect(conflicts).toEqual([])
    return { nodes: pendingInstances, edges: pendingEdges }
  }

  it('changes no port and writes no variant, so the export is as before', async () => {
    const library = bundledLibrary()
    const { nodes, edges } = finalModel(library)
    const plan = planCaPairing(nodes, edges)
    expect([...plan.ports.values()].flat().filter((port) => port.original)).toEqual([])
    expect(plan.residuals).toEqual([])
    expect(plan.failures).toEqual([])

    const files = await exported(nodes, edges, library)
    expect(moduleArray(files).filter((row) => row.module_subtype.includes('__'))).toEqual([])
    expect(notified.warning).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Connections Paired Differently' }))
  })
})
