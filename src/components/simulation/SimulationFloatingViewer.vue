<template>
  <Dialog
    v-model:visible="state.visible"
    :modal="false"
    draggable
    position="bottomright"
    :close-on-escape="false"
    :content-style="{ display: 'flex', flexDirection: 'column', minHeight: 0, padding: '0 12px 12px' }"
    :pt="{ root: { class: 'simulation-floating-viewer' }, header: { style: { padding: '8px 12px' } } }"
    aria-label="Floating simulation viewer"
    @show="pinWhereShown"
  >
    <template #header>
      <div class="viewer-head">
        <!-- The header drags the window; the grip shows where, and its controls don't drag it. -->
        <i class="pi pi-ellipsis-v viewer-grip" aria-hidden="true"></i>
        <Select
          v-model="plotId"
          :options="plotOptions"
          option-label="name"
          option-value="id"
          size="small"
          class="viewer-chart-select"
          aria-label="Plot to show"
          @mousedown.stop
        />
        <Button
          icon="pi pi-plus"
          text
          rounded
          size="small"
          :aria-label="`Change what ${shownPlotName} shows, or start a new plot`"
          aria-haspopup="true"
          v-tooltip.top="'Edit or add a plot'"
          @mousedown.stop
          @click="(event) => plotEditor.toggle(event)"
        />
        <ToggleSwitch
          v-model="isWholeModel"
          class="viewer-scope"
          aria-label="Simulate the whole model, not the selection"
          v-tooltip.top="isWholeModel ? 'Whole model' : `Selection (${selectedIds.length})`"
          @mousedown.stop
        />
        <Button
          v-if="isRunning"
          icon="pi pi-stop"
          text
          rounded
          size="small"
          severity="danger"
          aria-label="Stop the simulation"
          v-tooltip.top="'Stop'"
          @mousedown.stop
          @click="stop"
        />
        <Button
          v-else
          icon="pi pi-play"
          text
          rounded
          size="small"
          :disabled="!canPlay"
          :aria-label="isWholeModel ? 'Simulate the whole model' : `Simulate the selection (${selectedIds.length})`"
          v-tooltip.top="playHint"
          @mousedown.stop
          @click="play"
        />
        <Button
          icon="pi pi-sliders-h"
          :text="!showSliders"
          rounded
          size="small"
          :severity="showSliders ? 'primary' : 'secondary'"
          :aria-pressed="showSliders"
          aria-label="Show the sliders"
          v-tooltip.top="'Sliders'"
          @mousedown.stop
          @click="showSliders = !showSliders"
        />
        <Button
          icon="pi pi-sign-in"
          text
          rounded
          size="small"
          severity="secondary"
          aria-label="Back to the Simulation tab"
          v-tooltip.top="'Back to the Simulation tab'"
          @mousedown.stop
          @click="returnToTab"
        />
      </div>
    </template>

    <Popover ref="plotEditor">
      <div class="viewer-plot-editor">
        <template v-if="plotId !== INSPECTION_PLOT">
          <VariablePathPicker
            :index="variableIndex"
            :filter="(entry) => entry.plottable"
            :placeholder="`Add to ${shownPlotName}…`"
            :aria-label="`Add a variable to ${shownPlotName}`"
            @pick="plotEntry"
          />
          <p v-if="plotNote" class="viewer-note" role="status">{{ plotNote }}</p>
          <ul v-if="shownSelections.length" class="viewer-plot-variables">
            <li v-for="selection in shownSelections" :key="selection.key">
              <span><span class="viewer-muted">{{ nodeName(selection.nodeId) }}/</span><strong>{{ selection.variableName }}</strong></span>
              <Button
                icon="pi pi-times"
                text
                rounded
                size="small"
                severity="secondary"
                :aria-label="`Stop plotting ${selection.variableName}`"
                @click="settingsStore.setPlotConfig(removePlotSelection(settingsStore.plotConfig, selection.key))"
              />
            </li>
          </ul>
          <p v-else class="viewer-muted">Nothing on {{ shownPlotName }} yet.</p>
        </template>
        <Button label="New plot" icon="pi pi-plus" size="small" outlined @click="startNewPlot" />
      </div>
    </Popover>

    <!-- Rebuilt as the sliders show or hide, since a Splitter takes its panels as it mounts. -->
    <Splitter :key="showSliders ? 'with-sliders' : 'plot'" layout="vertical" class="viewer-body">
      <SplitterPanel :size="showSliders ? 60 : 100" :min-size="25" class="viewer-pane">
        <div ref="chartEl" class="viewer-chart">
          <template v-if="shownCharts.length">
            <SimulationPlot
              v-for="chart in shownCharts"
              :key="chart.key"
              :title="chart.title"
              :title-parts="chart.titleParts"
              :unit="chart.unit"
              :x="xAxis"
              :series="chart.series"
              :height="chartHeight"
            />
          </template>
          <p v-else class="viewer-empty">{{ emptyText }}</p>
        </div>
      </SplitterPanel>
      <SplitterPanel v-if="showSliders" :size="40" :min-size="15" class="viewer-pane viewer-sliders-pane">
        <SliderList
          class="viewer-sliders"
          with-picker
          :nodes="nodes"
          :scope-node-ids="store.scopeNodeIds"
          :keep-current="keepCurrent"
          @change="rerunForSliders"
        />
      </SplitterPanel>
    </Splitter>
  </Dialog>
</template>

<script setup>
/**
 * One plot of the results in a small window that floats over the canvas, as picture-in-picture does: pick
 * the plot in its header, drag it by the header, resize it from its corner (the plot follows), and keep it in
 * view while editing the model. It can show the sliders too, which rerun the shown scope as in the
 * Simulation tab.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Select from 'primevue/select'
import Popover from 'primevue/popover'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
import ToggleSwitch from 'primevue/toggleswitch'

import SimulationPlot from './SimulationPlot.vue'
import SliderList from './SliderList.vue'
import VariablePathPicker from './VariablePathPicker.vue'
import { useFloatingViewer } from '../../composables/useFloatingViewer'
import { useSimulation } from '../../composables/useSimulation'
import { INSPECTION_PLOT, useSimulationCharts } from '../../composables/useSimulationCharts'
import { useSliderReruns } from '../../composables/useSliderReruns'
import { libopencor } from '../../services/simulation/libopencorLoader'
import { addPlot, plotVariable, removePlotSelection, resolveGroups } from '../../services/simulation/plotSelections'
import { buildVariableIndex } from '../../services/simulation/variableIndex'
import { useSimulationResultsStore } from '../../stores/simulationResultsStore'
import { useSimulationSettingsStore } from '../../stores/simulationSettingsStore'
import { FLOW_IDS } from '../../utils/constants'

const props = defineProps({
  nodes: { type: Array, default: () => [] },
})

const { state, returnToTab } = useFloatingViewer()
const { getSelectedNodes } = useVueFlow(FLOW_IDS.MAIN)
const store = useSimulationResultsStore()
const settingsStore = useSimulationSettingsStore()
const { run, stop, keepCurrent } = useSimulation()
const { rerunForSliders } = useSliderReruns()

const showSliders = ref(false)
const isRunning = computed(() => store.status === 'running')

// Play here works as in the Simulation tab, sharing its choice of the selection or the whole model.
const selectedIds = computed(() => getSelectedNodes.value.map((node) => node.id).sort())
const isWholeModel = computed({
  get: () => store.scopeMode === 'model',
  set: (value) => (store.scopeMode = value ? 'model' : 'selection'),
})
const blockedReason = computed(() => {
  if (['unavailable', 'error'].includes(libopencor.status)) return libopencor.reason ?? 'The simulator isn’t available.'
  if (libopencor.status === 'loading') return 'Loading the simulator…'
  if (!isWholeModel.value && !selectedIds.value.length) return 'Select instances on the canvas'
  return null
})
const canPlay = computed(() => !blockedReason.value)
const playHint = computed(() => blockedReason.value ?? (isWholeModel.value ? 'Simulate the whole model' : `Simulate the selection (${selectedIds.value.length})`))

/** Simulates the whole model or the canvas selection, as the switch says. */
function play() {
  run(isWholeModel.value ? null : selectedIds.value)
}

// Showing the sliders makes the window taller, rather than squeezing the plot, with a divider between them
// to drag; hiding them gives the height back.
const SLIDERS_EXTRA_PX = 200
let addedHeight = 0
watch(showSliders, async (isShown) => {
  const element = document.querySelector('.simulation-floating-viewer')
  if (!element) return
  await nextTick()
  if (isShown) addedHeight = resizeBy(element, SLIDERS_EXTRA_PX)
  else {
    resizeBy(element, -addedHeight)
    addedHeight = 0
  }
})

/**
 * Makes the window taller or shorter, moving it up if it would run off the bottom of the page.
 *
 * @param {HTMLElement} element
 * @param {number} change - Pixels.
 * @returns {number} The change made, within the window's limits.
 */
function resizeBy(element, change) {
  const rect = element.getBoundingClientRect()
  const height = Math.max(240, Math.min(window.innerHeight * 0.9, rect.height + change))
  element.style.height = `${height}px`
  const overflow = rect.top + height - (window.innerHeight - 8)
  if (overflow > 0) element.style.top = `${Math.max(8, rect.top - overflow)}px`
  return height - rect.height
}
const scopeNodes = computed(() => (store.scopeNodeIds ? props.nodes.filter((node) => store.scopeNodeIds.includes(node.id)) : props.nodes))
const { xAxis, charts } = useSimulationCharts(scopeNodes)

// Every plot, empty ones too, so one can be picked and filled here; inspection outputs make one of their own.
const plotOptions = computed(() => {
  const plots = resolveGroups(settingsStore.plotConfig).map(({ id, name }) => ({ id, name }))
  return charts.value.some((chart) => chart.plotId === INSPECTION_PLOT) ? [...plots, { id: INSPECTION_PLOT, name: 'Inspection modules' }] : plots
})
// The plot shown: the one picked, or the first with something on it while that one is gone.
const plotId = ref(null)
watch(
  plotOptions,
  (plots) => {
    if (plots.some((plot) => plot.id === plotId.value)) return
    plotId.value = (charts.value[0]?.plotId ?? plots[0]?.id) || null
  },
  { immediate: true }
)
const shownPlotName = computed(() => plotOptions.value.find((plot) => plot.id === plotId.value)?.name ?? 'the plot')
// A plot from an older workspace that mixes units makes several charts, shown one under another.
const shownCharts = computed(() => charts.value.filter((chart) => chart.plotId === plotId.value))
const emptyText = computed(() => {
  if (!store.results) return 'Run a simulation to see it here.'
  return `Nothing on ${shownPlotName.value} yet: add a variable with +.`
})

// Changing what the plot shows, from the + beside its name.
const plotEditor = ref(null)
const plotNote = ref('')
const variableIndex = computed(() => buildVariableIndex(props.nodes, { scopeNodeIds: store.scopeNodeIds, mapping: store.mapping }))
const shownSelections = computed(() => (settingsStore.plotConfig?.selections ?? []).filter((selection) => selection.groupId === plotId.value))
const nodeName = (nodeId) => props.nodes.find((node) => node.id === nodeId)?.data?.name ?? 'missing instance'

/**
 * Plots a picked variable on the shown plot, or on one in its units (see plotVariable), and shows that plot.
 *
 * @param {Object} entry
 */
function plotEntry(entry) {
  const node = props.nodes.find((candidate) => candidate.id === entry.nodeId)
  const row = node?.data?.variables?.find((candidate) => candidate.name === entry.rowName)
  if (!node || !row) return
  const result = plotVariable(settingsStore.plotConfig, node, row, plotId.value)
  settingsStore.setPlotConfig(result.plotConfig)
  plotNote.value = result.plotId === plotId.value ? '' : `${entry.name} (${row.units || 'no units'}) went on its own plot: a plot shows one unit.`
  plotId.value = result.plotId
}

/** Starts an empty plot and shows it, to fill from the search. */
function startNewPlot() {
  const { plotConfig, id } = addPlot(settingsStore.plotConfig)
  settingsStore.setPlotConfig(plotConfig)
  plotId.value = id
  plotNote.value = ''
}

// The plot fills the space left to it, so resizing the window resizes the plot.
const chartEl = ref(null)
const chartAreaHeight = ref(300)
let resizeObserver = null
watch(chartEl, (element) => {
  resizeObserver?.disconnect()
  if (!element) return
  resizeObserver = new ResizeObserver(([entry]) => (chartAreaHeight.value = entry.contentRect.height))
  resizeObserver.observe(element)
})
onBeforeUnmount(() => resizeObserver?.disconnect())

// The plot's title and legend take about 54px besides the drawing, which includes its axes.
const CHART_CHROME_PX = 54
const chartHeight = computed(() =>
  Math.max(120, Math.round(chartAreaHeight.value / Math.max(1, shownCharts.value.length) - CHART_CHROME_PX))
)

/**
 * Pins the window where it opened, as a drag would, so resizing grows it from its corner rather than
 * against the edge of the page it starts against.
 */
function pinWhereShown() {
  const element = document.querySelector('.simulation-floating-viewer')
  if (!element) return
  const { left, top } = element.getBoundingClientRect()
  Object.assign(element.style, { position: 'fixed', left: `${left}px`, top: `${top}px`, margin: '0' })
}
</script>

<style scoped>
.viewer-head {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  margin-right: 4px;
}

.viewer-grip {
  padding: 4px 2px;
  color: var(--p-text-muted-color);
  cursor: move;
}

.viewer-chart-select {
  flex: 0 1 auto;
  min-width: 0;
  max-width: calc(100% - 11rem);
  margin-right: auto;
}

.viewer-scope {
  flex-shrink: 0;
  margin: 0 4px;
}

.viewer-body {
  flex: 1;
  min-height: 0;
  border: none;
  background: transparent;
}

.viewer-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.viewer-sliders-pane {
  overflow-y: auto;
  padding-top: 8px;
}

.viewer-plot-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 20rem;
  font-size: 0.8125rem;
}

.viewer-plot-editor > :last-child {
  align-self: flex-start;
}

.viewer-plot-variables {
  margin: 0;
  padding: 0;
  list-style: none;
}

.viewer-plot-variables li {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.viewer-muted,
.viewer-note {
  margin: 0;
  color: var(--p-text-muted-color);
}

.viewer-chart {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}



.viewer-empty {
  margin: auto 0;
  text-align: center;
  font-size: 0.8125rem;
  color: var(--p-text-muted-color);
}
</style>

<style>
/* Its first size, and resizable from its corner, as the Dialog itself isn't. Set here rather than as an
   inline style, which the Dialog would write back over a resize each time it renders. */
.simulation-floating-viewer {
  width: 460px;
  height: 400px;
  resize: both;
  overflow: hidden;
  min-width: 300px;
  min-height: 240px;
  max-width: 90vw;
  max-height: 90vh;
}
</style>
