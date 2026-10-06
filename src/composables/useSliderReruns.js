/**
 * Reruns the shown scope as sliders move, from wherever they are (the Simulation tab, the results dialog, the
 * floating viewer), as often as the simulator keeps up and always with the latest values: one run at a time,
 * and only the newest values wait. A run taking far longer than usual, as some values make a model hard to
 * solve, gives way to the newest values rather than holding the slider up.
 */
import { libopencor } from '../services/simulation/libopencorLoader'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { useSimulation } from './useSimulation'

const SLOW_RUN_MIN_MS = 150
const SLOW_RUN_FACTOR = 3
let sliderRun = null
let sliderRunStartedAt = 0
let isSliderRerunWaiting = false
const recentRunMs = []

/** Reruns the scope with the slider values, or queues the newest values behind the run going. */
function rerunForSliders(store, run) {
  // Before any run there is no scope to rerun: the next play uses the slider values.
  if (['unavailable', 'error'].includes(libopencor.status) || !store.results) return
  if (!sliderRun) {
    startSliderRun(store, run)
    return
  }
  isSliderRerunWaiting = true
  const typical = [...recentRunMs].sort((a, b) => a - b)[Math.floor(recentRunMs.length / 2)] ?? SLOW_RUN_MIN_MS
  // run() stops the run going and ignores its results.
  if (performance.now() - sliderRunStartedAt > Math.max(SLOW_RUN_MIN_MS, typical * SLOW_RUN_FACTOR)) startSliderRun(store, run)
}

/** Starts a rerun, then the newest waiting values once it is done. */
function startSliderRun(store, run) {
  isSliderRerunWaiting = false
  const startedAt = performance.now()
  sliderRunStartedAt = startedAt
  const thisRun = run(store.scopeNodeIds).finally(() => {
    // Superseded by a newer run, which carries on.
    if (sliderRun !== thisRun) return
    recentRunMs.push(performance.now() - startedAt)
    if (recentRunMs.length > 5) recentRunMs.shift()
    sliderRun = null
    if (isSliderRerunWaiting) startSliderRun(store, run)
  })
  sliderRun = thisRun
}

/**
 * Gives the shared slider rerun queue.
 *
 * @returns {{rerunForSliders: Function}}
 */
export function useSliderReruns() {
  const store = useSimulationResultsStore()
  const { run } = useSimulation()
  return { rerunForSliders: () => rerunForSliders(store, run) }
}
