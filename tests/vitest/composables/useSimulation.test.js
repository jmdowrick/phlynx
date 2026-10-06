// @vitest-environment happy-dom
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nodes = ref([])
const edges = ref([])
vi.mock('@vue-flow/core', async (importOriginal) => ({ ...(await importOriginal()), useVueFlow: () => ({ nodes, edges }) }))

const engine = vi.hoisted(() => ({ runs: [] }))
// Stands in for the simulator's worker client, recording each run so a test can finish it.
const simulator = vi.hoisted(() => ({
  startSimulation: (options) => {
    let finish
    const promise = new Promise((resolve) => (finish = resolve))
    const run = { options, finish, stop: vi.fn(), promise }
    engine.runs.push(run)
    return run
  },
}))
const loader = vi.hoisted(() => ({ module: simulator, reason: null, ready: null }))
vi.mock('../../../src/services/simulation/libopencorLoader', () => ({
  libopencor: { get reason() {
    return loader.reason
  } },
  whenLibOpenCORReady: () => loader.ready ?? Promise.resolve(loader.module),
}))


const built = vi.hoisted(() => ({ scopes: [] }))
vi.mock('../../../src/services/simulation/scopedModel', async (importOriginal) => ({
  ...(await importOriginal()),
  buildScopedModel: (scope) => {
    built.scopes.push(scope)
    return new Blob(['<model/>'])
  },
}))
vi.mock('../../../src/services/simulation/variableMapping', () => ({
  buildVariableMapping: () => new Map([['a::x', 'a/x']]),
  mapInspectionModules: () => [],
}))
vi.mock('../../../src/utils/cellml', () => ({ whenLibCellMLReady: async () => ({}) }))

const { cancelSimulation, useSimulation } = await import('../../../src/composables/useSimulation.js')
const { useSimulationResultsStore } = await import('../../../src/stores/simulationResultsStore.js')
const { useSimulationSettingsStore } = await import('../../../src/stores/simulationSettingsStore.js')
const { useLibraryStore } = await import('../../../src/stores/libraryStore.js')

const ODE = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m"><component name="m">
  <variable name="t" units="second"/><variable name="x" units="dimensionless" initial_value="1"/>
  <math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><cn>1</cn></apply></math>
</component></model>`

const RESULTS = { voi: { name: 'm/t', unit: 'second', values: new Float64Array([0, 1]) }, variables: new Map(), isStopped: false }

/**
 * Creates a node on the test math.
 *
 * @param {string} id
 * @param {Array} [variables]
 * @returns {Object}
 */
const createNode = (id, variables = [{ name: 'x', type: 'variable' }]) => ({ id, data: { name: id, mathRef: 'file:m', variables, ports: [] } })

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useSimulation', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    useLibraryStore().addMath('file:m', ODE)
    store = useSimulationResultsStore()
    nodes.value = [createNode('a'), createNode('b')]
    edges.value = []
    engine.runs = []
    built.scopes = []
    Object.assign(loader, { module: simulator, reason: null, ready: null })
  })

  it('runs the selection with the current settings and keeps its mapped results', async () => {
    const { run } = useSimulation()

    const done = run(['a'])
    await settle()
    expect(store.status).toBe('running')
    expect(engine.runs[0].options.settings).toEqual(useSimulationSettingsStore().simulationSettings)

    engine.runs[0].options.onProgress(0.5)
    expect(store.progress).toBe(0.5)
    engine.runs[0].finish(RESULTS)
    await done

    expect(store.status).toBe('done')
    expect(store.scopeNodeIds).toEqual(['a'])
    expect(store.results).toBe(RESULTS)
    expect(store.mapping.get('a::x')).toBe('a/x')
  })

  it('stops before running when the pre-flight finds errors', async () => {
    nodes.value = [createNode('a', [{ name: 'k', type: 'constant', value: '' }])]
    const { run } = useSimulation()

    await run(['a'])

    expect(store.status).toBe('blocked')
    expect(store.report.errors).toEqual(['"a.k" needs a value.'])
    expect(engine.runs).toHaveLength(0)
  })

  it('reports a simulator that couldn’t load', async () => {
    Object.assign(loader, { module: null, reason: 'This browser window doesn’t allow service workers.' })
    const { run } = useSimulation()

    await run(null)

    expect(store.status).toBe('error')
    expect(store.error.message).toMatch(/service workers/)
  })

  it('stops a run superseded by another, and ignores its results', async () => {
    const { run } = useSimulation()

    const first = run(['a'])
    await settle()
    const second = run(['b'])
    await settle()
    expect(engine.runs[0].stop).toHaveBeenCalled()

    engine.runs[0].finish({ ...RESULTS, isStopped: true })
    await first
    expect(store.status).toBe('running')

    engine.runs[1].finish(RESULTS)
    await second
    expect(store.scopeNodeIds).toEqual(['b'])
    expect(store.status).toBe('done')
  })

  /** Holds the simulator back until `release` is called, as while it downloads. */
  function holdSimulator() {
    let release
    loader.ready = new Promise((resolve) => (release = () => resolve(loader.module)))
    return () => release()
  }

  it('abandons a run stopped while the simulator is still loading', async () => {
    const release = holdSimulator()
    const { run, stop } = useSimulation()

    const done = run(['a'])
    await settle()
    stop()
    expect(store.status).toBe('idle')
    release()
    await done

    expect(engine.runs).toHaveLength(0)
    expect(store.status).toBe('idle')
  })

  it('starts only the newer of two runs begun while the simulator loads', async () => {
    const release = holdSimulator()
    const { run } = useSimulation()

    const first = run(['a'])
    const second = run(['b'])
    release()
    await settle()

    expect(engine.runs).toHaveLength(1)
    engine.runs[0].finish(RESULTS)
    await Promise.all([first, second])
    expect(store.scopeNodeIds).toEqual(['b'])
  })

  it('ignores a run abandoned when the workspace is cleared', async () => {
    const { run } = useSimulation()
    const done = run(['a'])
    await settle()

    cancelSimulation()
    store.resetState()
    engine.runs[0].finish(RESULTS)
    await done

    expect(engine.runs[0].stop).toHaveBeenCalled()
    expect(store.status).toBe('idle')
    expect(store.results).toBeNull()
  })

  it('builds each run with the sliders’ values, and tells when a slider has moved since', async () => {
    nodes.value = [createNode('a', [{ name: 'x', type: 'variable' }, { name: 'k', type: 'constant', value: '1' }])]
    useSimulationSettingsStore().setParameterScanConfig({
      selections: [{ key: 'a::k', nodeId: 'a', nodeName: 'a', parameterName: 'k', type: 'constant', min: 0, default: 1, max: 2 }],
    })
    store.setSliderValue('a::k', 1.5)
    const { run, isStale, keepCurrent } = useSimulation()

    const done = run(['a'])
    await settle()
    engine.runs[0].finish(RESULTS)
    await done

    expect(built.scopes[0].nodes[0].data.variables.find((row) => row.name === 'k').value).toBe('1.5')
    expect(nodes.value[0].data.variables.find((row) => row.name === 'k').value).toBe('1')
    expect(isStale.value).toBe(false)

    store.setSliderValue('a::k', 1.8)
    expect(isStale.value).toBe(true)
    store.setSliderValue('a::k', 1.5)
    expect(isStale.value).toBe(false)

    // Applying the value to the model and dropping the slider value leaves the results true.
    keepCurrent(() => {
      nodes.value = [createNode('a', [{ name: 'x', type: 'variable' }, { name: 'k', type: 'constant', value: '1.5' }])]
      store.setSliderValue('a::k', null)
    })
    expect(isStale.value).toBe(false)

    // Results already stale stay stale through such a change.
    useSimulationSettingsStore().setSimulationSettings({ endingPoint: 5 })
    keepCurrent(() => store.setSliderValue('a::k', null))
    expect(isStale.value).toBe(true)
  })

  it('keeps showing a scope’s results while it reruns, and clears them when a run fails', async () => {
    const { run } = useSimulation()
    const first = run(['a'])
    await settle()
    engine.runs[0].finish(RESULTS)
    await first

    const rerun = run(['a'])
    await settle()
    expect(store.status).toBe('running')
    expect(store.results).toBe(RESULTS)

    engine.runs[1].finish(Promise.reject(Object.assign(new Error('The simulation failed.'), { issues: [] })))
    await rerun
    expect(store.status).toBe('error')
    expect(store.results).toBeNull()
  })

  it('tells when the scope or the settings change after a run', async () => {
    const { run, isStale } = useSimulation()
    const done = run(['a'])
    await settle()
    engine.runs[0].finish(RESULTS)
    await done
    expect(isStale.value).toBe(false)

    nodes.value = [createNode('a'), { ...createNode('b'), data: { ...createNode('b').data, name: 'renamed' } }]
    expect(isStale.value).toBe(false)

    useSimulationSettingsStore().setSimulationSettings({ endingPoint: 5 })
    expect(isStale.value).toBe(true)
  })
})
