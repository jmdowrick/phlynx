import { defineStore } from 'pinia'
import { markRaw, ref, shallowRef } from 'vue'

/**
 * The latest in-app simulation: its scope, status and results. Never saved with the workspace.
 */
export const useSimulationResultsStore = defineStore('simulationResults', () => {
  /** 'idle', 'blocked' (the pre-flight found errors), 'running', 'done', 'stopped' or 'error'. */
  const status = ref('idle')
  const progress = ref(0)
  /** The node ids the run covered, or null for the whole model. */
  const scopeNodeIds = ref(null)
  /** The pre-flight report, worded: `{ errors, warnings }`. */
  const report = ref({ errors: [], warnings: [] })
  const error = ref(null)
  const results = shallowRef(null)
  const mapping = shallowRef(null)
  /** The run's inputs, to tell when its results have gone stale. */
  const signature = ref(null)
  // Colour slots of the plotted series by key, kept for the run so a series keeps its colour when the tab is
  // reopened. Not reactive: the charts read and update it as they are drawn.
  let seriesSlots = markRaw(new Map())
  const getSeriesSlots = () => seriesSlots
  const setSeriesSlots = (slots) => (seriesSlots = markRaw(slots))
  /** Slider values by parameter key, tried out in runs without changing the model. Kept across runs. */
  const sliderValues = ref(new Map())

  /**
   * Sets a slider's value, or clears it with null.
   *
   * @param {string} key
   * @param {number|null} value
   */
  function setSliderValue(key, value) {
    const next = new Map(sliderValues.value)
    if (value === null) next.delete(key)
    else next.set(key, value)
    sliderValues.value = next
  }

  /**
   * Records a run starting. A rerun of the same scope keeps showing the previous results until it finishes.
   *
   * @param {string[]|null} nodeIds
   */
  function startRun(nodeIds) {
    const isSameScope = JSON.stringify(nodeIds) === JSON.stringify(scopeNodeIds.value)
    status.value = 'running'
    progress.value = 0
    scopeNodeIds.value = nodeIds
    report.value = { errors: [], warnings: [] }
    error.value = null
    signature.value = null
    if (!isSameScope) {
      results.value = null
      mapping.value = null
      seriesSlots = markRaw(new Map())
    }
  }

  /**
   * Records a finished run.
   *
   * @param {Object} run - `{ results, mapping, signature }`.
   */
  function finishRun(run) {
    status.value = run.results.isStopped ? 'stopped' : 'done'
    progress.value = 1
    results.value = markRaw(run.results)
    mapping.value = markRaw(run.mapping)
    signature.value = run.signature
  }

  /**
   * Records a run that couldn't start, failed, or was abandoned before it started ('idle').
   *
   * @param {'blocked'|'error'|'idle'} nextStatus
   * @param {{message: string, issues?: Array}|null} [nextError]
   */
  function failRun(nextStatus, nextError = null) {
    status.value = nextStatus
    error.value = nextError
    results.value = null
    mapping.value = null
  }

  function resetState() {
    status.value = 'idle'
    progress.value = 0
    scopeNodeIds.value = null
    report.value = { errors: [], warnings: [] }
    error.value = null
    results.value = null
    mapping.value = null
    signature.value = null
    seriesSlots = markRaw(new Map())
    sliderValues.value = new Map()
  }

  return {
    status,
    progress,
    scopeNodeIds,
    report,
    error,
    results,
    mapping,
    signature,
    getSeriesSlots,
    setSeriesSlots,
    sliderValues,
    setSliderValue,
    startRun,
    finishRun,
    failRun,
    resetState,
  }
})
