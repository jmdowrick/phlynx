/**
 * Tracking the shown run, from wherever it is offered (the Runs list, the floating viewer): whether it can be
 * tracked, and tracking it with the slider values it ran with.
 */
import { computed } from 'vue'

import { describeRunInputs, MAX_TRACKED_RUNS } from '../services/simulation/trackedRuns'
import { GLOBAL_COMPONENT } from '../services/simulation/variableIndex'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'

/**
 * Gives what tracking the shown run needs.
 *
 * @returns {{liveInputs: import('vue').ComputedRef<Array<Object>>, trackBlocker: import('vue').ComputedRef<string|null>, track: Function}}
 */
export function useTrackRun() {
  const store = useSimulationResultsStore()
  const settingsStore = useSimulationSettingsStore()

  // The slider values the shown run ran with, named as the runs list shows them.
  const liveInputs = computed(() => describeRunInputs(store.runInputs?.overrides, settingsStore.parameterScanConfig?.selections, GLOBAL_COMPONENT))

  // Why the shown run can't be tracked, or null when it can.
  const trackBlocker = computed(() => {
    if (store.status === 'running') return 'Wait for the run to finish'
    if (!store.results) return 'Run the simulation first'
    if (!['done', 'stopped'].includes(store.status)) return 'The last run didn’t finish'
    if (store.trackedRuns.length >= MAX_TRACKED_RUNS) return `Up to ${MAX_TRACKED_RUNS} runs can be tracked: stop tracking one to track another`
    return null
  })

  /** Tracks the shown run, with the slider values it ran with. */
  function track() {
    if (!trackBlocker.value) store.trackRun(liveInputs.value)
  }

  return { liveInputs, trackBlocker, track }
}
