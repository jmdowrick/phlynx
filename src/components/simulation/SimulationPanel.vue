<template>
  <section class="simulation-panel">
    <h4 class="panel-title">Simulation</h4>

    <Message v-if="isSimulatorMissing" severity="warn" size="small">{{ libopencor.reason }}</Message>

    <div class="panel-actions">
      <Button
        label="Simulate selection"
        icon="pi pi-play"
        size="small"
        :disabled="!canRun || !selectedNodeIds.length"
        @click="run(selectedNodeIds)"
      />
      <Button label="Whole model" size="small" outlined :disabled="!canRun || !nodes.length" @click="run(null)" />
      <Button v-if="isRunning" label="Stop" icon="pi pi-stop" size="small" severity="danger" text @click="stop" />
    </div>
    <p v-if="libopencor.status === 'loading'" class="panel-hint">Loading the simulator…</p>
    <ProgressBar
      v-if="isRunning"
      :mode="store.progress > 0 ? 'determinate' : 'indeterminate'"
      :value="Math.round(store.progress * 100)"
      :show-value="false"
      class="panel-progress"
      aria-label="Simulation progress"
    />

    <Message v-if="store.status === 'blocked'" severity="error" size="small">
      The selection can’t be simulated yet:
      <ul class="panel-list">
        <li v-for="line in store.report.errors" :key="line">{{ line }}</li>
      </ul>
    </Message>
    <Message v-if="store.status === 'error'" severity="error" size="small">
      {{ store.error?.message }}
      <ul v-if="store.error?.issues?.length" class="panel-list">
        <li v-for="issue in store.error.issues" :key="issue.description">{{ issue.description }}</li>
      </ul>
    </Message>
    <details v-if="store.report.warnings.length && store.status !== 'blocked'" class="panel-warnings">
      <summary>
        {{ store.report.warnings.length }} {{ store.report.warnings.length === 1 ? 'warning' : 'warnings' }} about this run
      </summary>
      <ul class="panel-list">
        <li v-for="line in store.report.warnings" :key="line">{{ line }}</li>
      </ul>
    </details>
    <Message v-if="isStale" severity="secondary" size="small" class="panel-stale">
      The model or settings have changed since this run.
      <Button label="Run again" size="small" link :disabled="!canRun" @click="run(store.scopeNodeIds)" />
    </Message>

    <template v-if="hasScope">
      <p v-if="store.results" class="panel-hint">
        {{ scopeSummary }}<template v-if="store.status === 'stopped'">, stopped at {{ stoppedAt }}</template
        ><template v-else-if="store.status === 'error'">, up to {{ stoppedAt }} before the solver failed</template>.
      </p>

      <SimulationPlot
        v-for="chart in charts"
        :key="chart.key"
        :title="chart.title"
        :unit="chart.unit"
        :x="xAxis"
        :series="chart.series"
      />
      <p v-if="store.results && !charts.length" class="panel-hint">Tick variables below to plot them.</p>

      <section class="panel-edit" aria-labelledby="simulation-edit-title">
        <h5 id="simulation-edit-title" class="panel-subtitle">What gets plotted and tried out</h5>
        <label class="panel-label" for="simulation-instance">Instance</label>
        <Select
          v-model="editedNodeId"
          input-id="simulation-instance"
          :options="scopeNodes"
          option-label="data.name"
          option-value="id"
          size="small"
          class="panel-select"
        />

        <details v-if="editedNode" class="panel-section" open>
          <summary class="panel-section-title">Variables</summary>
          <div class="panel-picker">
            <InstancePlotVariables v-model="plotEntries" :rows="editedNode.data.variables" :initial-entries="initialEntries" />
          </div>
        </details>

        <SimulationSliders
          v-if="editedNode"
          :key="editedNode.id"
          :node="editedNode"
          :keep-current="keepCurrent"
          @change="rerunForSliders"
        />
      </section>
    </template>
    <p v-else-if="store.status === 'idle'" class="panel-hint">
      Select instances on the canvas and simulate them on their own, or simulate the whole model.
    </p>
  </section>
</template>

<script setup>
/**
 * The context sidebar's Simulation tab: runs scoped simulations and plots the chosen variables of one of
 * the simulated instances.
 */
import { computed, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import Button from 'primevue/button'
import Message from 'primevue/message'
import ProgressBar from 'primevue/progressbar'
import Select from 'primevue/select'

import InstancePlotVariables from '../InstancePlotVariables.vue'
import SimulationPlot from './SimulationPlot.vue'
import SimulationSliders from './SimulationSliders.vue'
import { useSimulation } from '../../composables/useSimulation'
import { libopencor } from '../../services/simulation/libopencorLoader'
import { getNodePlotEntries, normaliseGroups, setNodePlotVariables } from '../../services/simulation/plotSelections'
import { assignSeriesSlots, chunkSeries } from '../../services/simulation/seriesSlots'
import { readNodeSeries } from '../../services/simulation/variableMapping'
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

// The instance whose plotted variables and sliders are edited: the one selected on the canvas, if it
// was simulated, else the first simulated.
const editedNodeId = ref(null)
const editedNode = computed(() => scopeNodes.value.find((node) => node.id === editedNodeId.value) ?? null)
watch(
  [() => getSelectedNodes.value.map((node) => node.id).join(','), () => scopeNodes.value.map((node) => node.id).join(',')],
  () => {
    const selected = getSelectedNodes.value
    const isSimulated = (id) => scopeNodes.value.some((node) => node.id === id)
    if (selected.length === 1 && isSimulated(selected[0].id)) editedNodeId.value = selected[0].id
    else if (!isSimulated(editedNodeId.value)) editedNodeId.value = scopeNodes.value[0]?.id ?? null
  },
  { immediate: true }
)

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

// The edited instance's plotted variables, shared with the instance editor and Simulation Settings.
const plotEntries = computed({
  get: () => (editedNode.value ? getNodePlotEntries(simulationSettingsStore.plotConfig, editedNode.value.id) : []),
  set: (entries) => {
    if (!editedNode.value) return
    const plotConfig = setNodePlotVariables(simulationSettingsStore.plotConfig, editedNode.value, entries)
    if (plotConfig !== simulationSettingsStore.plotConfig) simulationSettingsStore.setPlotConfig(plotConfig)
  },
})
const initialEntries = ref([])
watch(editedNodeId, () => (initialEntries.value = plotEntries.value), { immediate: true })

const xAxis = computed(() => {
  const voi = store.results?.voi
  return { label: voi?.name.split('/').pop() ?? '', unit: voi?.unit ?? '', values: voi?.values ?? new Float64Array() }
})

// Inspection modules belong to no instance or plot group, so their outputs make a plot of their own.
const INSPECTION_PLOT = '__inspection_modules__'

/**
 * Gets every series to plot: the plotted variables of all the simulated instances, then the inspection
 * modules' outputs, each with the plot it belongs to.
 *
 * @returns {Array<{key: string, plot: string, label: string, unit: string, values: Float64Array}>}
 */
function collectSeries() {
  const nodesById = new Map(scopeNodes.value.map((node) => [node.id, node]))
  const variables = (simulationSettingsStore.plotConfig?.selections ?? []).flatMap((selection) => {
    const node = nodesById.get(selection.nodeId)
    const series = node && readNodeSeries(store.results, store.mapping, node.id, selection.variableName)
    if (!series) return []
    return [{ key: `${node.id}::${selection.variableName}`, plot: selection.groupId ?? '', node, name: selection.variableName, unit: series.unit || 'dimensionless', values: series.values }]
  })
  // Name each variable's instance once there's more than one to tell apart.
  const isFromSeveral = new Set(variables.map((series) => series.node.id)).size > 1
  const labelled = variables.map(({ node, name, ...series }) => ({ ...series, label: isFromSeveral ? `${node.data.name}.${name}` : name }))
  const outputs = store.inspectionOutputs.map((output) => ({
    key: `inspection::${output.id}`,
    plot: INSPECTION_PLOT,
    label: output.name,
    unit: output.units,
    values: store.results.variables.get(output.reportedName).values,
  }))
  return [...labelled, ...outputs]
}

/**
 * Names a chart: its series when few, else its plot.
 *
 * @param {Array<{label: string}>} series
 * @param {string} plotName
 * @returns {string}
 */
const titleFor = (series, plotName) =>
  series.length <= 3 ? series.map((item) => item.label).join(', ') : `${plotName} (${series.length} variables)`

// One chart per plot and unit, since one axis can't carry two; variables from different instances share a
// chart when they share both. A series keeps its colour while it stays plotted.
const charts = computed(() => {
  const previousSlots = store.getSeriesSlots()
  if (!store.results) return []
  const plotNames = new Map(normaliseGroups(simulationSettingsStore.plotConfig?.groups).map((group) => [group.id, group.name]))
  plotNames.set(INSPECTION_PLOT, 'Inspection modules')

  const byPlotAndUnit = new Map()
  for (const series of collectSeries()) {
    const id = `${series.plot}#${series.unit}`
    if (!byPlotAndUnit.has(id)) byPlotAndUnit.set(id, { plot: series.plot, unit: series.unit, series: [] })
    byPlotAndUnit.get(id).series.push(series)
  }

  const nextSlots = new Map()
  const result = []
  for (const [id, { plot, unit, series }] of byPlotAndUnit) {
    chunkSeries(series).forEach((group, index) => {
      const slots = assignSeriesSlots(previousSlots, group.map((item) => item.key))
      slots.forEach((slot, key) => nextSlots.set(key, slot))
      result.push({
        key: `${id}#${index}`,
        title: titleFor(group, plotNames.get(plot) ?? 'Ungrouped'),
        unit,
        series: group.map((item) => ({ key: item.key, label: item.label, values: item.values, slot: slots.get(item.key) })),
      })
    })
  }
  store.setSeriesSlots(new Map([...previousSlots, ...nextSlots]))
  return result
})
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

.panel-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--p-text-color);
}

.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.panel-hint {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--p-text-muted-color);
}

.panel-progress {
  height: 6px;
}

.panel-list {
  margin: 4px 0 0;
  padding-left: 18px;
}

.panel-warnings {
  font-size: 0.8125rem;
  color: var(--p-text-muted-color);
}

.panel-warnings summary {
  cursor: pointer;
  color: var(--p-text-color);
}

.panel-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
}

.panel-select {
  width: 100%;
}

.panel-edit {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--p-content-border-color);
}

.panel-subtitle {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--p-text-color);
}

.panel-section-title {
  cursor: pointer;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--p-text-color);
}

.panel-section[open] > .panel-section-title {
  margin-bottom: 8px;
}

.panel-picker {
  height: 300px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
