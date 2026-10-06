import { computed } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import { libopencor, whenLibOpenCORReady } from '../services/simulation/libopencorLoader'
import { buildParameterOverrides } from '../services/simulation/parameterSliders'
import {
  applyParameterOverrides,
  buildScopedModel,
  buildScopeSignature,
  checkScope,
  resolveScope,
  summariseScopeReport,
} from '../services/simulation/scopedModel'
import { buildVariableMapping, mapInspectionModules } from '../services/simulation/variableMapping'
import { useInspectionModuleStore } from '../stores/inspectionModuleStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'
import { whenLibCellMLReady } from '../utils/cellml'
import { FLOW_IDS } from '../utils/constants'

// One run at a time, shared by every caller; a newer run makes an older one's results irrelevant.
let currentRun = null
let runToken = 0

/**
 * Abandons the current run: stops its simulation and ignores anything it reports later. For a workspace
 * cleared or replaced mid-run.
 */
export function cancelSimulation() {
  runToken++
  currentRun?.stop()
  currentRun = null
}

/**
 * Runs scoped simulations of the workspace and keeps their results in simulationResultsStore.
 *
 * @returns {{run: Function, stop: Function, keepCurrent: Function, isStale: import('vue').ComputedRef<boolean>}}
 */
export function useSimulation() {
  const { nodes, edges } = useVueFlow(FLOW_IDS.MAIN)
  const libraryStore = useLibraryStore()
  const inspectionModuleStore = useInspectionModuleStore()
  const simulationSettingsStore = useSimulationSettingsStore()
  const store = useSimulationResultsStore()

  /**
   * Resolves the scope of some nodes, or of every node.
   *
   * @param {string[]|null} nodeIds
   * @returns {ReturnType<typeof resolveScope>}
   */
  const resolveCurrentScope = (nodeIds) => resolveScope(nodeIds, nodes.value, edges.value, inspectionModuleStore.modules)

  /**
   * Signs a run's inputs: its scope and the simulation settings.
   *
   * @param {ReturnType<typeof resolveScope>} scope
   * @returns {string}
   */
  const signRun = (scope, overrides) =>
    [
      buildScopeSignature(scope, libraryStore),
      JSON.stringify(simulationSettingsStore.simulationSettings),
      JSON.stringify([[...overrides.rows], [...overrides.globals]]),
    ].join(':')

  /** The slider values runs try out, for the sliders still defined. */
  const currentOverrides = () => buildParameterOverrides(simulationSettingsStore.parameterScanConfig?.selections, store.sliderValues)

  /**
   * Simulates some nodes, or the whole model: checks the scope, flattens it with the sliders' values, runs it
   * and maps its results back to the nodes. A pre-flight with errors stops it before it runs.
   *
   * @param {string[]|null} [nodeIds] - The nodes to simulate, or null for every node.
   * @returns {Promise<void>}
   */
  async function run(nodeIds = null) {
    cancelSimulation()
    const token = runToken
    store.startRun(nodeIds)

    const scope = resolveCurrentScope(nodeIds)
    store.report = summariseScopeReport(checkScope(scope, libraryStore))
    if (store.report.errors.length) {
      store.failRun('blocked')
      return
    }

    let cellml = null
    /**
     * Maps a failed run's partial results back to the nodes, as for a finished run.
     *
     * @param {Object} partialResults
     * @returns {Promise<{results: Object, mapping: Map}|null>}
     */
    const mapPartialResults = async (partialResults) => {
      if (!cellml) return null
      const libcellml = await whenLibCellMLReady()
      return { results: partialResults, mapping: buildVariableMapping({ libcellml, cellml, nodes: scope.nodes, results: partialResults }) }
    }

    try {
      const simulator = await whenLibOpenCORReady()
      if (token !== runToken) return
      if (!simulator) {
        store.failRun('error', { message: libopencor.reason ?? 'The simulator couldn’t load.', issues: [] })
        return
      }

      const overrides = currentOverrides()
      const withOverrides = applyParameterOverrides(scope, libraryStore, overrides)
      // libOpenCOR checks the model and reports its issues, so the flatten's own check is skipped.
      cellml = await buildScopedModel(withOverrides.scope, withOverrides.libraryStore, { check: false }).text()
      if (token !== runToken) return
      const signature = signRun(scope, overrides)
      const settings = { ...simulationSettingsStore.simulationSettings }
      currentRun = simulator.startSimulation({
        cellml,
        settings,
        onProgress: (progress) => token === runToken && (store.progress = progress),
      })
      const results = await currentRun.promise
      if (token !== runToken) return

      const libcellml = await whenLibCellMLReady()
      if (token !== runToken) return
      const mapping = buildVariableMapping({ libcellml, cellml, nodes: scope.nodes, results })
      const inspectionOutputs = mapInspectionModules(scope.inspectionModules, scope.nodes, results)
      store.finishRun({ results, mapping, signature, inspectionOutputs })
    } catch (error) {
      if (token === runToken) {
        const partial = error.partialResults && (await mapPartialResults(error.partialResults))
        if (token === runToken) store.failRun('error', { message: error.message, issues: error.issues ?? [] }, partial)
      }
    } finally {
      if (token === runToken) currentRun = null
    }
  }

  /** Stops the running simulation, keeping the points it computed; before it starts, abandons it. */
  function stop() {
    if (currentRun) {
      currentRun.stop()
      return
    }
    if (store.status !== 'running') return
    cancelSimulation()
    store.failRun('idle')
  }

  /**
   * Makes a change that keeps the shown results true, such as applying a slider's value to the model, and
   * keeps them current if they were.
   *
   * @param {Function} change
   */
  function keepCurrent(change) {
    const wasCurrent = !!store.results && !isStale.value
    change()
    if (wasCurrent) store.signature = signRun(resolveCurrentScope(store.scopeNodeIds), currentOverrides())
  }

  /** Whether the scope or the settings have changed since the shown results were computed. */
  const isStale = computed(() => {
    if (!store.signature || !store.results) return false
    return signRun(resolveCurrentScope(store.scopeNodeIds), currentOverrides()) !== store.signature
  })

  return { run, stop, keepCurrent, isStale }
}
