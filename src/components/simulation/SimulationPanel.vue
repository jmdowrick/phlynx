<template>
  <section ref="panelEl" class="simulation-panel" @keydown.f9.prevent="canPlay && play()">
    <header class="panel-head">
      <SimulationToolbar
        v-model:scope-mode="scopeMode"
        :part-name="instanceId ? 'this instance' : 'the selection'"
        :part-label="instanceId ? 'This instance' : null"
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
      <!-- Always there, so the bar showing and hiding never moves what is below it. -->
      <div class="panel-progress-slot">
        <ProgressBar
          v-if="isRunning"
          :mode="store.progress > 0 ? 'determinate' : 'indeterminate'"
          :value="Math.round(store.progress * 100)"
          :show-value="false"
          class="panel-progress"
          aria-label="Simulation progress"
        />
      </div>
      <SimulationStatusLine :status="statusLine" />
    </header>

    <!-- Plots and controls each scroll on their own, so a slider and the plot it moves stay in view. -->
    <Splitter
      v-if="layout"
      :key="layout"
      :layout="layout === 'columns' ? 'horizontal' : 'vertical'"
      class="panel-split"
      :class="`panel-split--${layout}`"
      @resizeend="saveSizes"
    >
      <SplitterPanel v-if="layout === 'columns'" :size="sizes.columns[0]" :min-size="25" class="panel-region">
        <SimulationControls
          v-model:view="controlsView"
          v-model:target-plot-id="targetPlotId"
          :nodes="nodes"
          :scope-node-ids="hasScope ? store.scopeNodeIds : null"
          :keep-current="keepCurrent"
          @change="rerunForSliders"
        />
      </SplitterPanel>
      <SplitterPanel :size="layout === 'columns' ? sizes.columns[1] : sizes.rows[0]" :min-size="20" class="panel-region panel-figures">
        <template v-if="charts.length">
          <SimulationPlot
            v-for="chart in charts"
            :key="chart.key"
            :title="chart.title"
            :title-parts="chart.titleParts"
            :unit="chart.unit"
            :x="xAxis"
            :series="chart.series"
            sync-key="simulation-panel"
          />
        </template>
        <p v-else class="panel-empty">{{ figuresHint }}</p>
      </SplitterPanel>
      <SplitterPanel v-if="layout === 'rows'" :size="sizes.rows[1]" :min-size="20" class="panel-region">
        <SimulationControls
          v-model:view="controlsView"
          v-model:target-plot-id="targetPlotId"
          :nodes="nodes"
          :scope-node-ids="hasScope ? store.scopeNodeIds : null"
          :keep-current="keepCurrent"
          @change="rerunForSliders"
        />
      </SplitterPanel>
    </Splitter>

    <SimulationResultsDialog
      v-if="hasScope"
      v-model:visible="isResultsDialogOpen"
      :summary="resultsSummary"
      :x="xAxis"
      :charts="charts"
      :nodes="nodes"
      :scope-node-ids="store.scopeNodeIds"
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
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import ProgressBar from 'primevue/progressbar'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
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

const props = defineProps({
  // In the instance editor: play runs this instance on its own, or the whole model.
  instanceId: { type: String, default: null },
})

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

// A solve that starts before the plots do, to let the model settle, says so.
const settleNote = computed(() => {
  const { initialPoint, startingPoint } = simulationSettingsStore.simulationSettings
  return initialPoint < startingPoint ? ` from ${initialPoint} s, plotted from ${startingPoint} s` : ''
})
const resultsSummary = computed(() => {
  if (store.status === 'stopped') return `${scopeSummary.value}${settleNote.value}, stopped at ${stoppedAt.value}.`
  if (store.status === 'error') return `${scopeSummary.value}${settleNote.value}, up to ${stoppedAt.value} before the solver failed.`
  return `${scopeSummary.value}${settleNote.value}.`
})
const isResultsDialogOpen = ref(false)

// Side by side once there is room for both, else plots above the controls.
const COLUMNS_FROM_PX = 640
const SIZES_KEY = 'phlynx.simulation.splitSizes'
const panelEl = ref(null)
// Null until measured, so the tab is drawn once, in the layout that fits.
const layout = ref(null)
// Kept here, so the Splitter rebuilding for the other layout doesn't reset them.
const controlsView = ref('plots')
const targetPlotId = ref(null)
const sizes = reactive(readSizes())
let resizeObserver = null

/**
 * Reads the split sizes this viewer chose last, as percentages.
 *
 * @returns {{rows: number[], columns: number[]}}
 */
function readSizes() {
  const fallback = { rows: [55, 45], columns: [38, 62] }
  try {
    const saved = JSON.parse(localStorage.getItem(SIZES_KEY) ?? 'null')
    const isPair = (pair) => Array.isArray(pair) && pair.length === 2 && pair.every(Number.isFinite)
    return { rows: isPair(saved?.rows) ? saved.rows : fallback.rows, columns: isPair(saved?.columns) ? saved.columns : fallback.columns }
  } catch {
    return fallback
  }
}

/**
 * Keeps the split sizes the viewer dragged to.
 *
 * @param {{sizes: number[]}} event
 */
function saveSizes({ sizes: next }) {
  sizes[layout.value] = next
  try {
    localStorage.setItem(SIZES_KEY, JSON.stringify(sizes))
  } catch {
    // Without storage, the sizes last for the session.
  }
}

onMounted(() => {
  const layoutFor = (width) => (width >= COLUMNS_FROM_PX ? 'columns' : 'rows')
  layout.value = layoutFor(panelEl.value.clientWidth)
  resizeObserver = new ResizeObserver(([entry]) => {
    if (entry.contentRect.width > 0) layout.value = layoutFor(entry.contentRect.width)
  })
  resizeObserver.observe(panelEl.value)
})
onBeforeUnmount(() => resizeObserver?.disconnect())

const figuresHint = computed(() => {
  if (!store.results) return 'Plots appear here after a run.'
  return 'Add variables to a plot to see them here.'
})

// Whether play runs the part (the selection, or the edited instance) or the whole model. The sidebar's
// choice lasts for the session; the instance editor's starts on the instance each time.
const editorScopeMode = ref('selection')
const scopeMode = computed({
  get: () => (props.instanceId ? editorScopeMode.value : store.scopeMode),
  set: (mode) => {
    if (props.instanceId) editorScopeMode.value = mode
    else store.scopeMode = mode
  },
})

// The canvas selection, sorted, as play runs it in Selection mode.
const sortedSelectedIds = computed(() => [...selectedNodeIds.value].sort())
// Why play can't run, if it can't.
const blockedReason = computed(() => {
  if (isSimulatorMissing.value) return libopencor.reason ?? 'The simulator isn’t available.'
  if (!nodes.value.length) return 'Add instances to simulate'
  if (!props.instanceId && scopeMode.value === 'selection' && !selectedNodeIds.value.length) return 'Select instances on the canvas'
  return null
})
const canPlay = computed(() => !isRunning.value && !blockedReason.value && libopencor.status !== 'loading')
// In Selection mode, the results show a selection other than the one on the canvas now.
const isSelectionChanged = computed(
  () =>
    !props.instanceId &&
    scopeMode.value === 'selection' &&
    !!store.results &&
    sortedSelectedIds.value.length > 0 &&
    JSON.stringify(sortedSelectedIds.value) !== JSON.stringify(store.scopeNodeIds ? [...store.scopeNodeIds].sort() : null)
)
// In the instance editor, results of another run than this instance on its own, or the whole model.
const isOtherRun = computed(() => {
  if (!props.instanceId || !store.results) return false
  const expected = scopeMode.value === 'model' ? null : [props.instanceId]
  return JSON.stringify(store.scopeNodeIds) !== JSON.stringify(expected)
})
const isOutdated = computed(() => !!store.results && (isStale.value || isSelectionChanged.value || isOtherRun.value))

/** Simulates the whole model or the canvas selection, as the switch says. */
function play() {
  if (scopeMode.value === 'model') run(null)
  else run(props.instanceId ? [props.instanceId] : sortedSelectedIds.value)
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
  // The progress bar shows how far; announcing each percent would flood a screen reader.
  if (isRunning.value) return { severity: 'info', icon: null, text: 'Running…', details: warnings }
  if (libopencor.status === 'loading') return { severity: 'info', icon: 'pi-spin pi-spinner', text: 'Loading the simulator…', details: [] }
  if (isStale.value && store.results) return { severity: 'warn', icon: 'pi-refresh', text: 'The model or settings changed · press play to update', details: warnings }
  if (isSelectionChanged.value) return { severity: 'warn', icon: 'pi-refresh', text: 'The selection changed · press play to update', details: warnings }
  if (isOtherRun.value) return { severity: 'warn', icon: 'pi-refresh', text: 'These results are from another run · press play to update', details: warnings }
  if (store.results) {
    const count = store.report.warnings.length
    const text = count ? `${resultsSummary.value} ${count} ${count === 1 ? 'warning' : 'warnings'}.` : resultsSummary.value
    return { severity: count ? 'warn' : 'info', icon: count ? 'pi-exclamation-triangle' : null, text, details: warnings }
  }
  return { severity: 'info', icon: null, text: 'Press play to simulate the whole model or the selected instances.', details: [] }
})

// While a slider moves, rerun as often as the simulator keeps up, always with the latest values: one run
// at a time, and only the newest value waits. A run taking far longer than usual, as some values make a
// model hard to solve, gives way to the newest value rather than holding the slider up.
const SLOW_RUN_MIN_MS = 150
const SLOW_RUN_FACTOR = 3
let sliderRun = null
let sliderRunStartedAt = 0
let isSliderRerunWaiting = false
const recentRunMs = []

/** Reruns the scope with the slider values, or queues the newest values behind the run going. */
function rerunForSliders() {
  // Before any run there is no scope to rerun: the next play uses the slider values.
  if (isSimulatorMissing.value || !store.results) return
  if (!sliderRun) {
    startSliderRun()
    return
  }
  isSliderRerunWaiting = true
  const typical = [...recentRunMs].sort((a, b) => a - b)[Math.floor(recentRunMs.length / 2)] ?? SLOW_RUN_MIN_MS
  // run() stops the run going and ignores its results.
  if (performance.now() - sliderRunStartedAt > Math.max(SLOW_RUN_MIN_MS, typical * SLOW_RUN_FACTOR)) startSliderRun()
}

/** Starts a rerun, then the newest waiting values once it is done. */
function startSliderRun() {
  isSliderRerunWaiting = false
  const startedAt = performance.now()
  sliderRunStartedAt = startedAt
  const thisRun = run(store.scopeNodeIds).finally(() => {
    // Superseded by a newer run, which carries on.
    if (sliderRun !== thisRun) return
    recentRunMs.push(performance.now() - startedAt)
    if (recentRunMs.length > 5) recentRunMs.shift()
    sliderRun = null
    if (isSliderRerunWaiting) startSliderRun()
  })
  sliderRun = thisRun
}

const { xAxis, charts } = useSimulationCharts(scopeNodes)
</script>

<style scoped>
.simulation-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  height: 100%;
  min-height: 0;
}

.panel-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
}

.panel-progress-slot {
  height: 3px;
}

.panel-progress {
  height: 3px;
}

.panel-split {
  flex: 1;
  min-height: 0;
  border: none;
  background: transparent;
}

.panel-region {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-split--rows .panel-region {
  padding: 8px 4px 8px 0;
}

.panel-split--columns .panel-region {
  padding: 4px 8px;
}

.panel-empty {
  margin: auto 0;
  font-size: 0.8125rem;
  text-align: center;
  color: var(--p-text-muted-color);
}
</style>
