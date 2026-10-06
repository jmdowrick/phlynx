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
        <Button
          v-if="isRunning"
          icon="pi pi-stop"
          text
          rounded
          size="small"
          severity="danger"
          aria-label="Stop the simulation"
          @mousedown.stop
          v-tooltip.top="'Stop'"
          @click="stop"
        />
        <Button
          v-else
          icon="pi pi-refresh"
          text
          rounded
          size="small"
          :disabled="!store.results"
          aria-label="Run the shown simulation again"
          @mousedown.stop
          v-tooltip.top="'Run again'"
          @click="run(store.scopeNodeIds)"
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
          @mousedown.stop
          v-tooltip.top="'Sliders'"
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
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Select from 'primevue/select'
import ToggleButton from 'primevue/togglebutton'

import SimulationPlot from './SimulationPlot.vue'
import SliderList from './SliderList.vue'
import { useFloatingViewer } from '../../composables/useFloatingViewer'
import { useSimulation } from '../../composables/useSimulation'
import { useSimulationCharts } from '../../composables/useSimulationCharts'
import { useSliderReruns } from '../../composables/useSliderReruns'
import { useSimulationResultsStore } from '../../stores/simulationResultsStore'

const props = defineProps({
  nodes: { type: Array, default: () => [] },
})

const { state } = useFloatingViewer()
const store = useSimulationResultsStore()
const { run, stop, keepCurrent } = useSimulation()
const { rerunForSliders } = useSliderReruns()

const showSliders = ref(false)
const isRunning = computed(() => store.status === 'running')
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
  max-width: calc(100% - 7rem);
  margin-right: auto;
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
  max-height: 45%;
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
