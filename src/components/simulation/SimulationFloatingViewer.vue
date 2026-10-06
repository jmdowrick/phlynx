<template>
  <Dialog
    v-model:visible="state.visible"
    :modal="false"
    draggable
    position="bottomright"
    :close-on-escape="false"
    :style="{ width: '460px', height: '440px' }"
    :content-style="{ display: 'flex', flexDirection: 'column', minHeight: 0, padding: '0 12px 12px' }"
    :pt="{ root: { class: 'simulation-floating-viewer' }, header: { style: { padding: '8px 12px' } } }"
    aria-label="Floating simulation viewer"
  >
    <template #header>
      <div class="viewer-head">
        <span class="viewer-title">Simulation</span>
        <Button
          v-if="isRunning"
          icon="pi pi-stop"
          text
          rounded
          size="small"
          severity="danger"
          aria-label="Stop the simulation"
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
          v-tooltip.top="'Sliders'"
        />
      </div>
    </template>

    <div ref="bodyEl" class="viewer-body">
      <div class="viewer-charts">
        <template v-if="charts.length">
          <SimulationPlot
            v-for="chart in charts"
            :key="chart.key"
            :title="chart.title"
            :title-parts="chart.titleParts"
            :unit="chart.unit"
            :x="xAxis"
            :series="chart.series"
            :height="chartHeight"
            sync-key="simulation-floating-viewer"
          />
        </template>
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
 * The results in a small window that floats over the canvas, as picture-in-picture does: drag it by its
 * header, resize it from its corner, and keep it in view while editing the model. It can show the sliders
 * too, which rerun the shown scope as in the Simulation tab.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
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

// Charts share the window's height, so resizing it resizes them, within reason.
const bodyEl = ref(null)
const bodyHeight = ref(300)
let resizeObserver = null
watch(bodyEl, (element) => {
  resizeObserver?.disconnect()
  if (!element) return
  resizeObserver = new ResizeObserver(([entry]) => (bodyHeight.value = entry.contentRect.height))
  resizeObserver.observe(element)
})
onBeforeUnmount(() => resizeObserver?.disconnect())

// Each chart's title, legend and gap take about 58px besides its plot (which includes its axes).
const CHART_CHROME_PX = 58
const chartHeight = computed(() => {
  const available = showSliders.value ? bodyHeight.value * 0.55 : bodyHeight.value
  return Math.round(Math.min(320, Math.max(150, available / Math.max(1, charts.value.length) - CHART_CHROME_PX)))
})
</script>

<style scoped>
.viewer-head {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.viewer-title {
  flex: 1;
  font-weight: 600;
  font-size: 0.875rem;
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

.viewer-charts {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
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
/* Resizable from its corner, as the Dialog itself isn't. */
.simulation-floating-viewer {
  resize: both;
  overflow: hidden;
  min-width: 300px;
  min-height: 220px;
  max-width: 90vw;
  max-height: 90vh;
}
</style>
