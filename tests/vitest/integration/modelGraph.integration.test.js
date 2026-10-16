// @vitest-environment happy-dom
import JSZip from 'jszip'
import { useVueFlow } from '@vue-flow/core'
import { createPinia, setActivePinia } from 'pinia'
import { computed, ref } from 'vue'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Exporting and simulating through libcellml and libOpenCOR takes seconds per test on CI.
vi.setConfig({ testTimeout: 120000 })

const notified = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() }))
vi.mock('../../../src/utils/notify', () => ({ notify: notified }))
vi.mock('../../../src/composables/useConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }) }))
vi.mock('../../../src/utils/save', () => ({ getFileHandle: vi.fn(async () => ({ success: true, handle: {}, cleanName: 'model' })) }))
// A simulator that keeps the models it is given, and finishes each run at once.
const simulator = vi.hoisted(() => ({
  models: [],
  startSimulation(options) {
    simulator.models.push(options.cellml)
    const voi = { name: 'environment/t', unit: 'second', values: new Float64Array([0, 1]) }
    return { promise: Promise.resolve({ voi, variables: new Map(), isStopped: false }), stop: () => {} }
  },
}))
vi.mock('../../../src/services/simulation/libopencorLoader', () => ({
  libopencor: { status: 'ready', reason: null },
  whenLibOpenCORReady: async () => simulator,
}))

const { useImportExportSend } = await import('../../../src/composables/useImportExportSend.js')
const { useModelGraph } = await import('../../../src/composables/useModelGraph.js')
const { useSimulation } = await import('../../../src/composables/useSimulation.js')
const { useSimulationRunner } = await import('../../../src/composables/useSimulationRunner.js')
const { generateExportZip } = await import('../../../src/services/export/ca.js')
const { createSliderDefinition } = await import('../../../src/services/simulation/parameterSliders.js')
const { buildScopedModel, resolveScope } = await import('../../../src/services/simulation/scopedModel.js')
const { compareCanonical } = await import('../../../src/services/testing/modelCompare.js')
const { useLibraryStore } = await import('../../../src/stores/libraryStore.js')
const { useSimulationResultsStore } = await import('../../../src/stores/simulationResultsStore.js')
const { useSimulationSettingsStore } = await import('../../../src/stores/simulationSettingsStore.js')
const { generateFlattenedModel } = await import('../../../src/utils/cellml.js')
const { FLOW_IDS } = await import('../../../src/utils/constants.js')
const { heartSlots, loadBundledLibrary, moduleFactory, threeInstances } = await import('../fixtures/hierarchy/equivalence.js')
const { ensureLibCellmlReady } = await import('../helpers/libcellml-bootstrap.js')

// The generated components' variables are named in the order edges are exported, so compare them by what they join.
const GENERATED = ['generated_summations', 'generated_multiplications']

/**
 * Reads a zip's text files.
 *
 * @param {Blob} blob
 * @returns {Promise<Object<string, string>>}
 */
async function readZip(blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir)
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await zip.file(name).async('string')])))
}

describe('model consumers read the expanded workspace', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  let store
  let make

  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    loadBundledLibrary(store)
    make = moduleFactory(store)
    simulator.models = []
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  /** Puts a graph in the workspace's store, as the canvas holds it. */
  const show = ({ nodes, edges }) => {
    flow.nodes.value = []
    flow.edges.value = []
    flow.addNodes(nodes)
    flow.addEdges(edges)
  }

  /** The export menu over the model, as the workspace sets it up. */
  function setUpExports() {
    const { modelNodes, modelEdges, errors, isHierarchical, expandSelection } = useModelGraph()
    return useImportExportSend({
      libcellml: { status: 'ready' },
      nodes: modelNodes,
      edges: modelEdges,
      importDialogVisible: ref(false),
      exportDialogVisible: ref(false),
      currentImportConfig: ref(null),
      onExportConfirm: vi.fn(),
      hasModelChanged: ref(false),
      snapshotFlowState: vi.fn(() => '{}'),
      selectedNodeIds: computed(() => expandSelection(flow.getSelectedNodes.value.map((node) => node.id))),
      modelErrors: errors,
      isHierarchical,
    })
  }

  /** Runs an export mode's action, as the workspace does once a file is chosen. */
  async function exportAs(label) {
    const exports = setUpExports()
    await exports.exportMenuItems.value.find((item) => item.label === label).command()
    return exports.currentExportMode.value.action('model')
  }

  it('exports the CellML of a nested workspace as of the flat one it stands for', async () => {
    const { nested, flat } = threeInstances(make)
    show(nested)
    const exported = await (await exportAs('CellML')).text()
    const handFlat = await (await generateFlattenedModel(flat.nodes, flat.edges, store, [])).text()
    const result = compareCanonical(exported, handFlat, { nameByConnection: GENERATED })
    expect(result.differences).toEqual([])
    expect(result.equal).toBe(true)
  })

  it('exports a nested workspace to circulatory_autogen as the flat one it stands for', async () => {
    const { nested, flat } = threeInstances(make)
    show(nested)
    const files = await readZip(await exportAs('Circulatory Autogen'))
    const handFlat = await readZip(await generateExportZip('model', flat.nodes, flat.edges, store))
    expect(files['model_module_array.csv']).toBe(handFlat['model_module_array.csv'])
    expect(files['model_module_array.csv']).toMatch(/seg2__a,vp,arterial_simple,seg1__a,seg3__a/)
    expect(files['model_parameters.csv']).toBe(handFlat['model_parameters.csv'])
    expect(files['modules/model_module_config.json']).toBe(handFlat['modules/model_module_config.json'])
  })

  it('checks circulatory_autogen’s heart rules on the modules inside subsystems', async () => {
    const { nested } = heartSlots(make)
    const spare = make('dndnode_9', 'spare_heart', 'heart:vp')
    show({ nodes: [...nested.nodes, spare], edges: nested.edges })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(exportAs('Circulatory Autogen')).rejects.toThrow('CA allows one heart module, but cardiac__heart, spare_heart are hearts.')
  })

  it('stops an export of a model whose flat names clash, before building it', async () => {
    const { nested } = threeInstances(make)
    const clash = make('dndnode_9', 'seg2__a', 'arterial_simple:vp')
    show({ nodes: [...nested.nodes, clash], edges: nested.edges })
    for (const label of ['CellML', 'Circulatory Autogen']) {
      await expect(exportAs(label)).rejects.toThrow('"seg2/a", "seg2__a" all have the flat name "seg2__a".')
    }
  })

  it('names a slider of a module inside a subsystem in the archive as the model exports it, after a rename', async () => {
    const { nested } = threeInstances(make)
    show(nested)
    const { findModelNode } = useModelGraph()
    const node = findModelNode('dndnode_1/a')
    const row = node.data.variables.find((candidate) => candidate.name === 'R')
    useSimulationSettingsStore().setParameterScanConfig({ selections: [createSliderDefinition(node, row, store.getGlobalConstant)] })
    flow.updateNodeData('dndnode_1', { name: 'mid' })

    const files = await readZip(await exportAs('OpenCOR'))
    const json = JSON.parse(files['simulation.json'])
    expect(json.input.map((entry) => entry.id)).toEqual(['id__mid__a__R'])
    expect(json.parameters).toEqual([{ name: 'instance_parameters/mid__a_R', value: 'id__mid__a__R' }])
    expect(files['model.cellml']).toMatch(/<component name="mid__a"/)
  })

  it('simulates a selected subsystem as its modules on their own', async () => {
    const { nested, flat } = threeInstances(make)
    show(nested)
    flow.addSelectedNodes([flow.findNode('dndnode_1')])
    const results = useSimulationResultsStore()
    results.scopeMode = 'selection'
    const runner = useSimulationRunner()
    expect(runner.playScopeNodeIds.value).toEqual(['dndnode_1/a'])

    runner.play()
    await vi.waitFor(() => expect(results.status).toBe('done'))
    expect(results.scopeNodeIds).toEqual(['dndnode_1/a'])
    expect(results.report.errors).toEqual([])
    const handFlat = await buildScopedModel(resolveScope(['f1'], flat.nodes, flat.edges), store, { check: false }).text()
    const result = compareCanonical(simulator.models[0], handFlat, { nameByConnection: GENERATED })
    expect(result.differences).toEqual([])
  })

  it('tells whether results are current without checking the expanded model', async () => {
    const { nested } = threeInstances(make)
    show(nested)
    const results = useSimulationResultsStore()
    const simulation = useSimulation()
    await simulation.run(null)
    await vi.waitFor(() => expect(results.status).toBe('done'))
    expect(simulation.isStale.value).toBe(false)

    flow.updateNodeData('dndnode_1', { name: 'mid' })
    const checked = vi.spyOn(useModelGraph().graph.value, 'errors', 'get')
    expect(simulation.isStale.value).toBe(true)
    simulation.keepCurrent(() => {})
    expect(checked).not.toHaveBeenCalled()
  })

  it('stops a run of a model whose subsystems don’t expand, saying why', async () => {
    const { nested } = threeInstances(make)
    const sm = nested.nodes.find((node) => node.id === 'sm_1')
    sm.data.supermodule.exposedPorts = sm.data.supermodule.exposedPorts.filter((port) => port.id !== 'xp_out')
    show(nested)
    const results = useSimulationResultsStore()
    await useSimulation().run(null)
    expect(results.status).toBe('blocked')
    expect(results.report.errors).toEqual([
      'Edge "e0" couples to port "xp_out" of "seg1", which its super-module no longer exposes.',
      'Edge "e1" couples to port "xp_out" of "seg2", which its super-module no longer exposes.',
    ])
    expect(simulator.models).toEqual([])
  })
})
