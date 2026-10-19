// @vitest-environment happy-dom
/**
 * The instance folders of the CellML export with imports: beside each module's and super-module's file, a folder per
 * instance and super instance whose model.cellml, its imports resolved within the zip, validates, analyses and runs on
 * its own, given its inputs: the values connections give it in the workspace, prefilled from the last run.
 */
import createLibOpenCOR from '@opencor/libopencor'
import JSZip from 'jszip'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildHierarchicalCellML,
  flattenZipFile,
  generateHierarchicalCellMLZip,
  normalisePath,
  prefillStandaloneInputs,
  standaloneInputs,
} from '../../../src/services/export/cellmlHierarchical.js'
import { expandHierarchy } from '../../../src/services/hierarchy/expand.js'
import { buildCaModel, foldCaModel } from '../../../src/services/import/caFold.js'
import { startSimulation } from '../../../src/services/simulation/engine.js'
import { buildVariableMapping } from '../../../src/services/simulation/variableMapping.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { generateFlattenedModel } from '../../../src/utils/cellml.js'
import { BASELINE_SIMULATION_SETTINGS } from '../../../src/utils/constants.js'
import { connect, exposed, exposures, superInstance, supermodule } from '../fixtures/hierarchy/graph.js'
import { loadBundledLibrary, moduleFactory, twoLevel } from '../fixtures/hierarchy/equivalence.js'
import { selfLeafTanks, tankKit } from '../fixtures/hierarchy/tanks.js'
import { libraryOf, loadCaLibrary, systemModel } from '../helpers/caLibrary.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

vi.setConfig({ testTimeout: 120000 })

let libcellml
let libOpenCOR

/** A model's issues, as libcellml's Validator or Analyser gives them. */
const issuesOf = (text, Checker, check) => {
  const parser = new libcellml.Parser(false)
  const checker = new Checker()
  const model = parser.parseModel(text)
  checker[check](model)
  const issues = Array.from({ length: checker.errorCount() }, (_, i) => checker.error(i).description())
  ;[model, checker, parser].forEach((object) => object.delete())
  return issues
}

/** Runs a CellML for a while. */
const run = (cellml, endTime = 0.5) =>
  startSimulation({
    module: libOpenCOR,
    cellml,
    settings: { ...BASELINE_SIMULATION_SETTINGS, startingPoint: 0, initialPoint: 0, endingPoint: endTime, pointInterval: endTime / 10 },
  }).promise

/** The coupled model's run, as the last run the prompt is prefilled from: `{results, mapping}`. */
async function coupledRun({ nodes, edges }, store, { allowBcOnly = false, endTime = 0.5 } = {}) {
  const expansion = expandHierarchy(nodes, edges)
  const cellml = await (await generateFlattenedModel(expansion.nodes, expansion.edges, store, [], { allowBcOnly })).text()
  const results = await run(cellml, endTime)
  return { cellml, results, mapping: buildVariableMapping({ libcellml, cellml, nodes: expansion.nodes, results }) }
}

/**
 * Flattens an instance folder's model from the zip, expects it to validate and analyse, runs it, and expects every value
 * finite.
 *
 * @returns {Promise<Object>} Its results.
 */
async function expectRuns(files, folder, { endTime = 0.5 } = {}) {
  const cellml = await flattenZipFile(files, `${folder}model.cellml`)
  expect(issuesOf(cellml, libcellml.Validator, 'validateModel'), folder).toEqual([])
  expect(issuesOf(cellml, libcellml.Analyser, 'analyseModel'), folder).toEqual([])
  const results = await run(cellml, endTime)
  expect(results.variables.size, folder).toBeGreaterThan(0)
  for (const [name, { values }] of results.variables) expect(Array.from(values).every(Number.isFinite), `${folder} ${name}`).toBe(true)
  return results
}

/** Each import's href, as the zip path it resolves to from its file. */
const importedFiles = (file, text) => [...text.matchAll(/xlink:href="([^"]+)"/g)].map(([, href]) => normalisePath(`${file.slice(0, file.lastIndexOf('/') + 1)}${href}`))

describe('the instance folders of the CellML export with imports', () => {
  let store

  beforeAll(async () => {
    ;({ instance: libcellml } = await ensureLibCellmlReady())
    libOpenCOR = await createLibOpenCOR()
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  /** Four root tanks draining into two organs, each two cells of a branch whose u its tank gives it (own value 1). */
  const nestedTanks = () => {
    const { tank, branch } = tankKit(store)
    const leaf = branch('leaf', 'leaf', { scope: 'sm_in', values: { u: '1' } })
    const cell = supermodule('sm_in', 'cell', { submoduleOrder: ['leaf'] })
    const cellExposure = exposures('sm_in', [exposed('xp', 'leaf', 'entrance_ports', 'vessel')])
    const cells = { nodes: [cell, leaf], edges: cellExposure }
    const c1 = superInstance(cells, 'c1', 'c1', 'sm_in', { scope: 'sm_out' })
    const c2 = superInstance(cells, 'c2', 'c2', 'sm_in', { scope: 'sm_out', overrides: { leaf: { k: { value: '0.3' } } } })
    const organ = supermodule('sm_out', 'organ', { submoduleOrder: ['c1', 'c2'] })
    const exposure = [...exposures('sm_out', [exposed('x1', 'c1', null, null, { via: 'xp' }), exposed('x2', 'c2', null, null, { via: 'xp' })]), ...cellExposure]
    const inner = { nodes: [organ, c1, c2, cell, leaf], edges: exposure }
    const o1 = superInstance(inner, 'dndnode_1', 'o1', 'sm_out', { overrides: { 'c1/leaf': { k: { value: '0.2' } } } })
    const o2 = superInstance(inner, 'dndnode_2', 'o2', 'sm_out')
    const tanks = [0, 1, 2, 3].map((i) => tank(`dndnode_h${i}`, `h${i}`, { values: { q_init: String(i + 1) } }))
    const used = new Set()
    const edges = [[0, o1], [1, o1], [2, o2], [3, o2]].map(([i, target]) => connect(tanks[i], target, { used, id: `e${i}` }))
    return { nodes: [...tanks, o1, o2, ...inner.nodes], edges: [...edges, ...exposure] }
  }

  /** A tank draining into an organ, a tissue, a cell and its branch, three levels down, and into a branch of its own. */
  const threeLevels = () => {
    const { tank, branch } = tankKit(store)
    const leaf = branch('leaf', 'leaf', { scope: 'sm_3' })
    const s3 = supermodule('sm_3', 'cell', { submoduleOrder: ['leaf'] })
    const e3 = exposures('sm_3', [exposed('xp', 'leaf', 'entrance_ports', 'vessel')])
    const i3 = superInstance({ nodes: [s3, leaf], edges: e3 }, 'c', 'c', 'sm_3', { scope: 'sm_2' })
    const s2 = supermodule('sm_2', 'tissue', { submoduleOrder: ['c'] })
    const e2 = [...exposures('sm_2', [exposed('xp2', 'c', null, null, { via: 'xp' })]), ...e3]
    const i2 = superInstance({ nodes: [s2, i3, s3, leaf], edges: e2 }, 't', 't', 'sm_2', { scope: 'sm_1' })
    const s1 = supermodule('sm_1', 'organ', { submoduleOrder: ['t'] })
    const e1 = [...exposures('sm_1', [exposed('xp1', 't', null, null, { via: 'xp2' })]), ...e2]
    const inner = { nodes: [s1, i2, s2, i3, s3, leaf], edges: e1 }
    const o1 = superInstance(inner, 'dndnode_1', 'o1', 'sm_1', { overrides: { 't/c/leaf': { k: { value: '0.2' } } } })
    const h = tank('dndnode_0', 'h')
    const own = branch('dndnode_3', 'own')
    return { nodes: [h, own, o1, ...inner.nodes], edges: [connect(h, o1, { id: 'e0' }), connect(h, own, { id: 'e1' }), ...e1] }
  }

  /** Exports a graph with its inputs prefilled from the coupled model's run. */
  const exportFromRun = async (graph, { allowBcOnly = false } = {}) => {
    const lastRun = await coupledRun(graph, store, { allowBcOnly })
    const folders = await standaloneInputs(graph.nodes, graph.edges, store, { allowBcOnly })
    const standaloneValues = prefillStandaloneInputs(folders, lastRun)
    return { ...(await buildHierarchicalCellML(graph.nodes, graph.edges, store, { allowBcOnly, standaloneValues })), lastRun, folders }
  }

  it('gives each module and super-module a folder, and each of their instances and super instances one in it', async () => {
    loadBundledLibrary(store)
    const { nested } = twoLevel(moduleFactory(store))
    const zip = await JSZip.loadAsync(await (await generateHierarchicalCellMLZip('model', nested.nodes, nested.edges, store)).arrayBuffer())
    const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir)
    const files = new Map(await Promise.all(names.map(async (name) => [name, await zip.file(name).async('string')])))
    const folders = [...new Set(names.filter((name) => name.includes('/instances/')).map((name) => name.slice(0, name.lastIndexOf('/') + 1)))]
    expect(folders.sort()).toEqual(
      [
        'modules/pv_simple_type/instances/aorta/',
        'modules/pv_simple_type/instances/leg__art/',
        'modules/pp_T_fixed_I_type/instances/leg__bed__cap/',
        'modules/vp_ven_simple_type/instances/vc/',
        'supermodules/limb/instances/leg/',
        'supermodules/capillary_bed/instances/leg__bed/',
      ].sort()
    )
    for (const folder of folders) {
      expect(files.has(`${folder}model.cellml`), folder).toBe(true)
      expect(files.has(`${folder}parameters.cellml`), folder).toBe(true)
    }
    // A folder's model imports its definition's file and its own parameters, its files' units from its own units file.
    const imports = (file) => [...new Set([...files.get(file).matchAll(/xlink:href="([^"]+)"/g)].map(([, href]) => href))].sort()
    expect(imports('modules/pv_simple_type/instances/aorta/model.cellml')).toEqual(['../../pv_simple_type.cellml', 'parameters.cellml'])
    expect(imports('modules/pv_simple_type/instances/aorta/parameters.cellml')).toEqual(['units.cellml'])
    expect(imports('supermodules/capillary_bed/instances/leg__bed/model.cellml')).toEqual(['../../capillary_bed.cellml', 'parameters.cellml'])
    expect(files.get('supermodules/limb/instances/leg/model.cellml')).toMatch(/<component component_ref="limb" name="leg"\/>/)
    // Every import, of every file, resolves within the zip.
    for (const [file, text] of files) for (const target of importedFiles(file, text)) expect(files.has(target), `${file} imports ${target}`).toBe(true)
    // An instance's values are in its parameters, its overrides included.
    expect(files.get('modules/pv_simple_type/instances/leg__art/parameters.cellml')).toMatch(/<variable name="R" units="[^"]+" initial_value="4" interface="public"\/>/)
    expect(files.get('README.txt')).toMatch(/Not runnable on their own/)
  })

  it('runs a root module instance, a module instance in a super-module, a super instance and a nested one on their own', async () => {
    const graph = nestedTanks()
    const { files, standalone, readme, lastRun } = await exportFromRun(graph)
    expect(standalone.map((unit) => unit.folder)).toEqual(
      expect.arrayContaining([
        'modules/tank/instances/h0/',
        'modules/branch/instances/o1__c1__leaf/',
        'supermodules/organ/instances/o1/',
        'supermodules/cell/instances/o1__c1/',
        'supermodules/cell/instances/o2__c2/',
      ])
    )
    expect(standalone.filter((unit) => unit.missing.length || unit.problem).map((unit) => [unit.folder, unit.missing, unit.problem])).toEqual([])
    expect(readme).not.toMatch(/Not runnable/)
    // The inputs: a tank's sum, and each cell's u, which its tank gives it.
    const inputsOf = (folder) => standalone.find((unit) => unit.folder === folder).inputs.map((input) => input.label)
    expect(inputsOf('modules/tank/instances/h0/')).toEqual(['v_sum'])
    expect(inputsOf('modules/branch/instances/o1__c1__leaf/')).toEqual(['u'])
    expect(inputsOf('supermodules/organ/instances/o1/')).toEqual(['c1/leaf.u', 'c2/leaf.u'])
    expect(inputsOf('supermodules/cell/instances/o1__c1/')).toEqual(['leaf.u'])

    for (const unit of standalone) await expectRuns(files, unit.folder)
    // Its inputs fixed at the coupled model's start values, a branch starts as it does in the coupled model.
    const alone = await expectRuns(files, 'modules/branch/instances/o2__c2__leaf/')
    const coupled = lastRun.mapping.get('dndnode_2/c2/leaf::v')
    expect(alone.variables.get('o2__c2__leaf/v').values[0]).toBeCloseTo(lastRun.results.variables.get(coupled).values[0], 9)
  })

  it('runs a super instance nested two levels down on its own', async () => {
    const { files, standalone } = await exportFromRun(threeLevels())
    expect(standalone.map((unit) => unit.folder)).toEqual(
      expect.arrayContaining(['supermodules/organ/instances/o1/', 'supermodules/tissue/instances/o1__t/', 'supermodules/cell/instances/o1__t__c/'])
    )
    expect(standalone.filter((unit) => unit.missing.length || unit.problem).map((unit) => [unit.folder, unit.missing, unit.problem])).toEqual([])
    // The global constant reaches it from its own parameters.
    expect(files.get('supermodules/cell/instances/o1__t__c/parameters.cellml')).toMatch(/<variable name="g" units="dimensionless" initial_value="2"/)
    for (const unit of standalone) await expectRuns(files, unit.folder)
  })

  it('runs a super instance whose wrapper is its self leaf on its own, the self leaf having no folder of its own', async () => {
    const { files, standalone } = await exportFromRun(selfLeafTanks(store))
    expect(standalone.map((unit) => unit.folder).sort()).toEqual([
      'modules/drain/instances/p1__drain/',
      'modules/drain/instances/p2__drain/',
      'supermodules/reservoir/instances/p1/',
      'supermodules/reservoir/instances/p2/',
    ])
    expect(standalone.filter((unit) => unit.missing.length || unit.problem).map((unit) => [unit.folder, unit.missing, unit.problem])).toEqual([])
    const alone = await expectRuns(files, 'supermodules/reservoir/instances/p2/')
    // Its own initial volume, overridden to 2.
    expect(alone.variables.get('p2/q').values[0]).toBe(2)
  })

  it('runs every instance of a workspace without super-modules on its own', async () => {
    const { tank, branch } = tankKit(store)
    const tanks = [tank('dndnode_h1', 'h1', { values: { q_init: '2' } }), tank('dndnode_h2', 'h2')]
    const branches = [branch('dndnode_b1', 'b1', { values: { k: '0.5' } }), branch('dndnode_b2', 'b2')]
    const graph = { nodes: [...tanks, ...branches], edges: [connect(tanks[0], branches[0], { id: 'e0' }), connect(tanks[1], branches[1], { id: 'e1' })] }
    const { files, standalone } = await exportFromRun(graph)
    expect(standalone.map((unit) => unit.folder).sort()).toEqual(['modules/branch/instances/b1/', 'modules/branch/instances/b2/', 'modules/tank/instances/h1/', 'modules/tank/instances/h2/'])
    expect([...files.keys()].some((file) => file.startsWith('supermodules/'))).toBe(false)
    for (const unit of standalone) await expectRuns(files, unit.folder)
  })

  it('prefills an input from the last run, else its own value, else blank', async () => {
    const graph = nestedTanks()
    const folders = await standaloneInputs(graph.nodes, graph.edges, store)
    const leafU = folders.find((folder) => folder.folder === 'modules/branch/instances/o1__c1__leaf/').inputs[0]
    const sum = folders.find((folder) => folder.folder === 'modules/tank/instances/h0/').inputs[0]
    // No run: the own value, else blank.
    const unrun = prefillStandaloneInputs(folders)
    expect(unrun.get(leafU.id)).toBe('1')
    expect(unrun.get(sum.id)).toBe('')
    // A run that reported the variable: its start value.
    const lastRun = await coupledRun(graph, store)
    const ran = prefillStandaloneInputs(folders, lastRun)
    expect(Number(ran.get(leafU.id))).toBeCloseTo(1, 12)
    expect(Number(ran.get(sum.id))).toBeCloseTo(lastRun.results.variables.get(lastRun.mapping.get('dndnode_h0::v_sum')).values[0], 12)
    // One that didn't: the own value again.
    expect(prefillStandaloneInputs(folders, { results: { variables: new Map() }, mapping: new Map() }).get(leafU.id)).toBe('1')
  })

  it('writes every folder, listing in the README those an input was given no value as not runnable', async () => {
    const graph = nestedTanks()
    const folders = await standaloneInputs(graph.nodes, graph.edges, store)
    const values = prefillStandaloneInputs(folders, await coupledRun(graph, store))
    const blank = folders.find((folder) => folder.folder === 'supermodules/organ/instances/o1/').inputs[1]
    values.set(blank.id, '')
    const { files, standalone, readme } = await buildHierarchicalCellML(graph.nodes, graph.edges, store, { standaloneValues: values })
    expect(standalone.filter((unit) => unit.missing.length).map((unit) => [unit.folder, unit.missing])).toEqual([['supermodules/organ/instances/o1/', ['c2/leaf.u']]])
    expect(files.has('supermodules/organ/instances/o1/model.cellml')).toBe(true)
    expect(readme).toMatch(/Not runnable on their own \(1\):\n {2}supermodules\/organ\/instances\/o1\/model\.cellml: no value given for c2\/leaf\.u\n/)
    expect(readme).toMatch(/Runnable on their own \(\d+\):[\s\S]*supermodules\/organ\/instances\/o2\/model\.cellml/)
  })
})

describe('the instance folders of circulatory_autogen super-modules', () => {
  let store
  let load

  beforeAll(async () => {
    ;({ instance: libcellml } = await ensureLibCellmlReady())
    libOpenCOR ??= await createLibOpenCOR()
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    ;({ load } = loadCaLibrary(store))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it.each([
    ['3compartment_supermodules', 'system_models/closed_loop_cvs/3compartment_supermodules'],
    ['SN_simple_supermodules', 'system_models/cellular/SN_simple_supermodules'],
  ])('%s: every super instance and instance runs on its own from the coupled model’s start values', async (_, path) => {
    const { rows, hostRows } = systemModel(path)
    const library = libraryOf(store)
    const model = buildCaModel(rows, library, { load, hostRows })
    const graph = foldCaModel(model, library, { load })
    for (const { name, value, units, data_reference } of model.globals) store.assignGlobalConstant(name, value, units, data_reference)

    const lastRun = await coupledRun(graph, store, { allowBcOnly: true, endTime: 0.01 })
    const folders = await standaloneInputs(graph.nodes, graph.edges, store, { allowBcOnly: true })
    const standaloneValues = prefillStandaloneInputs(folders, lastRun)
    const { files, standalone } = await buildHierarchicalCellML(graph.nodes, graph.edges, store, { allowBcOnly: true, standaloneValues })
    const supers = standalone.filter((unit) => unit.kind === 'super')
    expect(supers.length).toBeGreaterThan(0)
    expect(standalone.filter((unit) => unit.missing.length || unit.problem).map((unit) => [unit.folder, unit.missing, unit.problem])).toEqual([])
    // Its module instances too, volume_sum's VoI, which no ODE integrates, held at its start.
    for (const unit of standalone) await expectRuns(files, unit.folder, { endTime: 0.01 })
  })
})
