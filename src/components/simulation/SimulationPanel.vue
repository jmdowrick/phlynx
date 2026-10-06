<template>
  <section class="simulation-panel" @keydown.f9.prevent="canPlay && play()">
    <SimulationToolbar
      v-model:scope-mode="store.scopeMode"
      :is-running="isRunning"
      :is-loading="libopencor.status === 'loading'"
      :blocked-reason="blockedReason"
      :selected-count="selectedNodeIds.length"
      :is-outdated="isOutdated"
      :can-expand="charts.length > 0"
      @play="play"
      @stop="stop"
      @expand="isResultsDialogOpen = true"
    />
    <ProgressBar
      v-if="isRunning"
      :mode="store.progress > 0 ? 'determinate' : 'indeterminate'"
      :value="Math.round(store.progress * 100)"
      :show-value="false"
      class="panel-progress"
      aria-label="Simulation progress"
    />
    <SimulationStatusLine :status="statusLine" />

    <template v-if="hasScope">
      <SimulationPlot
        v-for="chart in charts"
        :key="chart.key"
        :title="chart.title"
        :unit="chart.unit"
        :x="xAxis"
        :series="chart.series"
        sync-key="simulation-panel"
      />
      <SimulationResultsDialog
        v-model:visible="isResultsDialogOpen"
        :summary="resultsSummary"
        :x="xAxis"
        :charts="charts"
        :nodes="nodes"
        :scope-node-ids="store.scopeNodeIds"
        :keep-current="keepCurrent"
        @change="rerunForSliders"
      />
      <p v-if="store.results && !charts.length" class="panel-hint">Add variables below to plot them.</p>
    </template>

    <SimulationControls
      class="panel-edit"
      :nodes="nodes"
      :scope-node-ids="hasScope ? store.scopeNodeIds : null"
      :keep-current="keepCurrent"
      @change="rerunForSliders"
    />
  </section>
</template>

<script setup>
/**
 * The context sidebar's Simulation tab: runs scoped simulations and plots the chosen variables of one of
 * the simulated instances.
 */
import { computed, ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import ProgressBar from 'primevue/progressbar'
import Select from 'primevue/select'

import SimulationControls from './SimulationControls.vue'
import SimulationPlot from './SimulationPlot.vue'
import SimulationResultsDialog from './SimulationResultsDialog.vue'
import SimulationStatusLine from './SimulationStatusLine.vue'
import SimulationToolbar from './SimulationToolbar.vue'
import { useSimulation } from '../../composables/useSimulation'
import { useSimulationCharts } from '../../composables/useSimulationCharts'
import { libopencor } from '../../services/simulation/libopencorLoader'
import { useSimulationResultsStore } from '../../stores/simulationResultsStore'
import { useSimulationSettingsStore } from '../../stores/simulationSettingsStore'
import { FLOW_IDS } from '../../utils/constants'

const { nodes, getSelectedNodes } = useVueFlow(FLOW_IDS.MAIN)
const store = useSimulationResultsStore()
const simulationSettingsStore = useSimulationSettingsStore()
const { run, stop, keepCurrent, isStale } = useSimulation()

const isRunning = computed(() => store.status === 'running')
// A run has been asked for, so its scope's instances, plotted variables and sliders can be shown.
const hasScope = computed(() => store.status !== 'idle')
const isSimulatorMissing = computed(() => ['unavailable', 'error'].includes(libopencor.status))
const canRun = computed(() => !isRunning.value && !isSimulatorMissing.value)
const selectedNodeIds = computed(() => getSelectedNodes.value.map((node) => node.id))

const scopeNodes = computed(() =>
  store.scopeNodeIds ? nodes.value.filter((node) => store.scopeNodeIds.includes(node.id)) : nodes.value
)
const scopeSummary = computed(() => {
  if (!store.scopeNodeIds) return 'Simulated the whole model'
  const count = store.scopeNodeIds.length
  return `Simulated ${count} ${count === 1 ? 'instance' : 'instances'} on their own`
})
const stoppedAt = computed(() => {
  const voi = store.results?.voi
  return voi?.values.length ? `${voi.values.at(-1).toPrecision(4)} ${voi.unit}` : 'the start'
})

const resultsSummary = computed(() => {
  if (store.status === 'stopped') return `${scopeSummary.value}, stopped at ${stoppedAt.value}.`
  if (store.status === 'error') return `${scopeSummary.value}, up to ${stoppedAt.value} before the solver failed.`
  return `${scopeSummary.value}.`
})
const isResultsDialogOpen = ref(false)

// The canvas selection, sorted, as play runs it in Selection mode.
const sortedSelectedIds = computed(() => [...selectedNodeIds.value].sort())
// Why play can't run, if it can't.
const blockedReason = computed(() => {
  if (isSimulatorMissing.value) return libopencor.reason ?? 'The simulator isn’t available.'
  if (!nodes.value.length) return 'Add instances to simulate'
  if (store.scopeMode === 'selection' && !selectedNodeIds.value.length) return 'Select instances on the canvas'
  return null
})
const canPlay = computed(() => !isRunning.value && !blockedReason.value && libopencor.status !== 'loading')
// In Selection mode, the results show a selection other than the one on the canvas now.
const isSelectionChanged = computed(
  () =>
    store.scopeMode === 'selection' &&
    !!store.results &&
    sortedSelectedIds.value.length > 0 &&
    JSON.stringify(sortedSelectedIds.value) !== JSON.stringify(store.scopeNodeIds ? [...store.scopeNodeIds].sort() : null)
)
const isOutdated = computed(() => !!store.results && (isStale.value || isSelectionChanged.value))

/** Simulates the whole model or the canvas selection, as the switch says. */
function play() {
  run(store.scopeMode === 'model' ? null : sortedSelectedIds.value)
}

// What the status line says: the most pressing thing first, with the full lists a click away.
const statusLine = computed(() => {
  const warnings = store.report.warnings.length ? [{ title: 'Warnings', lines: store.report.warnings }] : []
  if (isSimulatorMissing.value) return { severity: 'error', icon: 'pi-exclamation-circle', text: libopencor.reason ?? 'The simulator isn’t available.', details: [] }
  if (store.status === 'blocked') {
    const count = store.report.errors.length
    return { severity: 'error', icon: 'pi-exclamation-circle', text: `Can’t simulate yet: ${count} ${count === 1 ? 'problem' : 'problems'}`, details: [{ title: 'Problems', lines: store.report.errors }] }
  }
  if (store.status === 'error') {
    const issues = (store.error?.issues ?? []).map((issue) => issue.description)
    return {
      severity: 'error',
      icon: 'pi-exclamation-circle',
      text: store.results ? `${store.error?.message} ${resultsSummary.value}` : store.error?.message ?? 'The simulation failed.',
      details: [...(issues.length ? [{ title: 'Solver messages', lines: issues }] : []), ...warnings],
    }
  }
  if (isRunning.value) return { severity: 'info', icon: null, text: store.progress > 0 ? `Running… ${Math.round(store.progress * 100)}%` : 'Running…', details: warnings }
  if (libopencor.status === 'loading') return { severity: 'info', icon: 'pi-spin pi-spinner', text: 'Loading the simulator…', details: [] }
  if (isStale.value && store.results) return { severity: 'warn', icon: 'pi-refresh', text: 'The model or settings changed · press play to update', details: warnings }
  if (isSelectionChanged.value) return { severity: 'warn', icon: 'pi-refresh', text: 'The selection changed · press play to update', details: warnings }
  if (store.results) {
    const count = store.report.warnings.length
    const text = count ? `${resultsSummary.value} ${count} ${count === 1 ? 'warning' : 'warnings'}.` : resultsSummary.value
    return { severity: count ? 'warn' : 'info', icon: count ? 'pi-exclamation-triangle' : null, text, details: warnings }
  }
  return { severity: 'info', icon: null, text: 'Press play to simulate the whole model or the selected instances.', details: [] }
})

// While a slider moves, rerun as often as the simulator keeps up, always with the latest values.
let sliderRun = null
let isSliderRerunWaiting = false
function rerunForSliders() {
  if (isSimulatorMissing.value) return
  if (sliderRun) {
    isSliderRerunWaiting = true
    return
  }
  sliderRun = run(store.scopeNodeIds).finally(() => {
    sliderRun = null
    if (isSliderRerunWaiting) {
      isSliderRerunWaiting = false
      rerunForSliders()
    }
  })
}


const { xAxis, charts } = useSimulationCharts(scopeNodes)
</script>

<style scoped>
.simulation-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: 0 4px 16px 0;
}

.panel-hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--p-text-muted-color);
}

.panel-progress {
  height: 3px;
}

.panel-edit {
  margin-top: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--p-content-border-color);
}
</style>
