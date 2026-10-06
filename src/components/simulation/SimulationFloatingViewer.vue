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
          v-if="charts.length"
          v-model="chartKey"
          :options="charts"
          option-label="plotLabel"
          option-value="key"
          size="small"
          class="viewer-chart-select"
          aria-label="Plot to show"
          @mousedown.stop
        />
        <span v-else class="viewer-title">Simulation</span>
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
        <ToggleButton
          v-model="showSliders"
          on-icon="pi pi-sliders-h"
          off-icon="pi pi-sliders-h"
          on-label=""
          off-label=""
          size="small"
          class="viewer-sliders-toggle"
          aria-label="Show the sliders"
          v-tooltip.top="'Sliders'"
          @mousedown.stop
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

    <div class="viewer-body">
      <div ref="chartEl" class="viewer-chart">
        <SimulationPlot
          v-if="chart"
          :key="chart.key"
          :title="chart.title"
          :title-parts="chart.titleParts"
          :unit="chart.unit"
          :x="xAxis"
          :series="chart.series"
          :height="chartHeight"
        />
        <p v-else class="viewer-empty">{{ store.results ? 'Nothing is plotted yet.' : 'Run a simulation to see it here.' }}</p>
      </div>
      <SliderList
        v-if="showSliders"
        class="viewer-sliders"
        with-picker
        :nodes="nodes"
        :scope-node-ids="store.scopeNodeIds"
        :keep-current="keepCurrent"
        @change="rerunForSliders"
      />
    </div>
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
import ToggleButton from 'primevue/togglebutton'
import ToggleSwitch from 'primevue/toggleswitch'

import SimulationPlot from './SimulationPlot.vue'
import SliderList from './SliderList.vue'
import { useFloatingViewer } from '../../composables/useFloatingViewer'
import { useSimulation } from '../../composables/useSimulation'
import { useSimulationCharts } from '../../composables/useSimulationCharts'
import { useSliderReruns } from '../../composables/useSliderReruns'
import { libopencor } from '../../services/simulation/libopencorLoader'
import { useSimulationResultsStore } from '../../stores/simulationResultsStore'
import { FLOW_IDS } from '../../utils/constants'

const props = defineProps({
  nodes: { type: Array, default: () => [] },
})

const { state, returnToTab } = useFloatingViewer()
const { getSelectedNodes } = useVueFlow(FLOW_IDS.MAIN)
const store = useSimulationResultsStore()
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

// Showing the sliders makes the window taller by their height, rather than squeezing the plot; hiding them
// gives that height back.
let slidersHeight = 0
watch(showSliders, async (isShown) => {
  const element = document.querySelector('.simulation-floating-viewer')
  if (!element) return
  if (isShown) {
    await nextTick()
    slidersHeight = (element.querySelector('.viewer-sliders')?.offsetHeight ?? 0) + 8
    resizeBy(element, slidersHeight)
  } else {
    resizeBy(element, -slidersHeight)
    slidersHeight = 0
  }
})

/**
 * Makes the window taller or shorter, moving it up if it would run off the bottom of the page.
 *
 * @param {HTMLElement} element
 * @param {number} change - Pixels.
 */
function resizeBy(element, change) {
  const rect = element.getBoundingClientRect()
  const height = Math.max(240, Math.min(window.innerHeight * 0.9, rect.height + change))
  element.style.height = `${height}px`
  const overflow = rect.top + height - (window.innerHeight - 8)
  if (overflow > 0) element.style.top = `${Math.max(8, rect.top - overflow)}px`
}
const scopeNodes = computed(() => (store.scopeNodeIds ? props.nodes.filter((node) => store.scopeNodeIds.includes(node.id)) : props.nodes))
const { xAxis, charts } = useSimulationCharts(scopeNodes)

// The plot shown: the one picked, or the first while that one is gone.
const chartKey = ref(null)
const chart = computed(() => charts.value.find((candidate) => candidate.key === chartKey.value) ?? charts.value[0] ?? null)
watch(chart, (shown) => (chartKey.value = shown?.key ?? null), { immediate: true })

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
const chartHeight = computed(() => Math.max(120, Math.round(chartAreaHeight.value - CHART_CHROME_PX)))

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

.viewer-title {
  margin-right: auto;
  font-weight: 600;
  font-size: 0.875rem;
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

.viewer-sliders-toggle {
  padding: 0.25rem 0.4rem;
}

.viewer-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.viewer-chart {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.viewer-sliders {
  flex-shrink: 0;
  max-height: 40vh;
  overflow-y: auto;
  padding-top: 8px;
  border-top: 1px solid var(--p-content-border-color);
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
