<template>
  <Dialog
    v-model:visible="visible"
    header="Simulation results"
    maximizable
    modal
    :maximize-button-props="{
      severity: 'secondary',
      text: true,
      rounded: true,
      'aria-label': isMaximized ? 'Restore the results to their size' : 'Maximise the results',
    }"
    :style="{ width: 'min(1100px, 92vw)' }"
    :content-style="{ display: 'flex', flexDirection: 'column', minHeight: 0 }"
    class="simulation-results-dialog"
    @maximize="isMaximized = true"
    @unmaximize="isMaximized = false"
  >
    <div class="results-toolbar">
      <p class="results-summary">{{ summary }}</p>
      <SelectButton
        v-model="view"
        :options="VIEWS"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        size="small"
        aria-label="Show the results as"
      />
      <ToggleButton
        v-model="isEditing"
        on-label="Edit"
        off-label="Edit"
        on-icon="pi pi-sliders-h"
        off-icon="pi pi-sliders-h"
        size="small"
        aria-label="Show what gets plotted and tried out"
      />
      <Button label="CSV" icon="pi pi-download" size="small" outlined aria-label="Download the results as CSV" @click="downloadCsv" />
      <Button
        label="PNG"
        icon="pi pi-image"
        size="small"
        outlined
        :disabled="view !== 'charts'"
        aria-label="Download the charts as a PNG image"
        @click="downloadPng"
      />
    </div>

    <div class="results-body" :class="{ 'results-body--editing': isEditing, 'results-body--fill': isMaximized }">
      <div class="results-main">
        <!-- The charts stay mounted under the table, so their zoom survives a look at the numbers. -->
        <div v-show="view === 'charts'" ref="chartsEl" class="results-charts">
          <SimulationPlot
            v-for="chart in charts"
            :key="chart.key"
            :ref="(plot) => setPlot(chart.key, plot)"
            :title="chart.title"
            :unit="chart.unit"
            :x="xAxis"
            :series="chart.series"
            :height="chartHeight"
            sync-key="simulation-results-dialog"
          />
          <p class="results-hint">Drag across a chart to zoom in; double-click it to zoom out.</p>
        </div>

        <DataTable
          v-if="view === 'table'"
          :value="rows"
          :virtual-scroller-options="{ itemSize: ROW_HEIGHT }"
          scrollable
          :scroll-height="isMaximized ? 'flex' : '60vh'"
          size="small"
          class="results-table"
          data-key="index"
          aria-label="Plotted results"
        >
          <Column v-for="column in columns" :key="column.key" :header="columnHeader(column)">
            <template #body="{ data }">{{ formatValue(column.values[data.index]) }}</template>
          </Column>
        </DataTable>
      </div>

      <SimulationControls
        v-if="isEditing"
        class="results-edit"
        :nodes="nodes"
        :scope-node-ids="scopeNodeIds"
        :keep-current="keepCurrent"
        @change="emit('change')"
      />
    </div>
  </Dialog>
</template>

<script setup>
/**
 * The plotted results at full size: the Simulation tab's charts with their cursors in step, or a table of
 * their values, and either downloaded as CSV or the charts as one PNG. Beside them, as in the tab, an
 * instance's plotted variables and sliders can be changed.
 */
import { computed, ref } from 'vue'

import Button from 'primevue/button'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import SelectButton from 'primevue/selectbutton'
import ToggleButton from 'primevue/togglebutton'

import SimulationControls from './SimulationControls.vue'
import SimulationPlot from './SimulationPlot.vue'
import { buildResultsCsv, collectResultColumns, columnHeader, composeChartsImage } from '../../services/simulation/resultsExport'
import { legacyDownload } from '../../utils/save'

const VIEWS = [
  { label: 'Charts', value: 'charts' },
  { label: 'Table', value: 'table' },
]
const ROW_HEIGHT = 33
const FILE_NAME = 'simulation-results'

const visible = defineModel('visible', { type: Boolean, default: false })
const props = defineProps({
  summary: { type: String, default: '' },
  x: { type: Object, required: true }, // { label, unit, values }
  charts: { type: Array, required: true }, // [{ key, title, unit, series }], as the Simulation tab shows them
  // Every node, whose variables can be plotted or given sliders beside the charts.
  nodes: { type: Array, required: true },
  // The nodes the shown run simulated, or null for all of them.
  scopeNodeIds: { type: Array, default: null },
  keepCurrent: { type: Function, required: true },
})
// A slider moved, so the scope wants running again.
const emit = defineEmits(['change'])

const view = ref('charts')
const isEditing = ref(true)
const isMaximized = ref(false)
const chartsEl = ref(null)
// The mounted charts, by chart key.
const plots = new Map()

/**
 * Keeps a chart's component, or forgets it once unmounted.
 *
 * @param {string} key
 * @param {Object|null} plot
 */
function setPlot(key, plot) {
  if (plot) plots.set(key, plot)
  else plots.delete(key)
}

const xAxis = computed(() => props.x)
// Taller charts when there's room for them.
const chartHeight = computed(() => (isMaximized.value ? 360 : 280))
const columns = computed(() => collectResultColumns(props.x, props.charts))
const rows = computed(() => Array.from({ length: props.x.values.length }, (_, index) => ({ index })))

/**
 * Formats a value for the table, to 6 significant figures.
 *
 * @param {number|undefined} value
 * @returns {string}
 */
const formatValue = (value) => (Number.isFinite(value) ? Number(value.toPrecision(6)).toString() : String(value ?? ''))

/** Downloads every plotted series as CSV, at full precision. */
function downloadCsv() {
  legacyDownload(`${FILE_NAME}.csv`, new Blob([buildResultsCsv(columns.value)], { type: 'text/csv' }))
}

/** Downloads the charts, as shown, as one PNG on the dialog's background. */
function downloadPng() {
  const snapshots = props.charts.map((chart) => plots.get(chart.key)?.snapshot()).filter(Boolean)
  if (!snapshots.length) return
  const style = getComputedStyle(chartsEl.value.closest('.p-dialog'))
  const image = composeChartsImage(snapshots, { background: style.backgroundColor, text: style.color })
  image.toBlob((blob) => blob && legacyDownload(`${FILE_NAME}.png`, blob), 'image/png')
}
</script>

<style scoped>
.results-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.results-summary {
  flex: 1;
  min-width: 12rem;
  margin: 0;
  font-size: 0.8125rem;
  color: var(--p-text-muted-color);
}

.results-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 20px;
}

.results-body--editing {
  grid-template-columns: minmax(0, 1fr) 320px;
}

/* Maximised, the body fills the window, so the table can scroll within it. */
.results-body--fill {
  flex: 1;
  min-height: 0;
}

.results-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.results-body--fill .results-main {
  min-height: 0;
}

/* Beside the charts, scrolling on its own so it stays in view as they scroll. */
.results-edit {
  align-self: start;
  position: sticky;
  top: 0;
  max-height: 75vh;
  overflow-y: auto;
  padding-left: 20px;
  border-left: 1px solid var(--p-content-border-color);
}

@media (max-width: 760px) {
  .results-body--editing {
    grid-template-columns: minmax(0, 1fr);
  }

  .results-edit {
    position: static;
    max-height: none;
    padding-left: 0;
    border-left: none;
  }
}

.results-charts {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.results-hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.results-table {
  flex: 1;
  min-height: 0;
  font-variant-numeric: tabular-nums;
}
</style>
