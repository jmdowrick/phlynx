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
        {{ scopeSummary }}<template v-if="store.status === 'stopped'">, stopped at {{ stoppedAt }}</template>.
      </p>

      <label class="panel-label" for="simulation-instance">Instance</label>
      <Select
        v-model="shownNodeId"
        input-id="simulation-instance"
        :options="scopeNodes"
        option-label="data.name"
        option-value="id"
        size="small"
        class="panel-select"
      />

      <div v-if="shownNode" class="panel-picker">
        <InstancePlotVariables v-model="plotEntries" :rows="shownNode.data.variables" :initial-entries="initialEntries" />
      </div>

      <SimulationSliders
        v-if="shownNode"
        :key="shownNode.id"
        :node="shownNode"
        :keep-current="keepCurrent"
        @change="!isSimulatorMissing && run(store.scopeNodeIds)"
      />

      <SimulationPlot
        v-for="chart in charts"
        :key="chart.key"
        :title="chart.title"
        :unit="chart.unit"
        :x="xAxis"
        :series="chart.series"
      />
      <p v-if="store.results && shownNode && !charts.length" class="panel-hint">Tick variables above to plot them.</p>
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
import { getNodePlotEntries, setNodePlotVariables } from '../../services/simulation/plotSelections'
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

// The instance shown: the one selected on the canvas when it was simulated, else the first simulated.
const shownNodeId = ref(null)
const shownNode = computed(() => scopeNodes.value.find((node) => node.id === shownNodeId.value) ?? null)
watch(
  [
    () => getSelectedNodes.value.map((node) => node.id).join(','),
    () => scopeNodes.value.map((node) => node.id).join(','),
    () => store.results,
  ],
  () => {
    const selected = getSelectedNodes.value
    const inScope = (id) => scopeNodes.value.some((node) => node.id === id)
    if (selected.length === 1 && inScope(selected[0].id)) shownNodeId.value = selected[0].id
    else if (!inScope(shownNodeId.value)) shownNodeId.value = scopeNodes.value[0]?.id ?? null
  },
  { immediate: true }
)

// The shown instance's plotted variables, shared with the instance editor and Simulation Settings.
const plotEntries = computed({
  get: () => (shownNode.value ? getNodePlotEntries(simulationSettingsStore.plotConfig, shownNode.value.id) : []),
  set: (entries) => {
    if (!shownNode.value) return
    const plotConfig = setNodePlotVariables(simulationSettingsStore.plotConfig, shownNode.value, entries)
    if (plotConfig !== simulationSettingsStore.plotConfig) simulationSettingsStore.setPlotConfig(plotConfig)
  },
})
const initialEntries = ref([])
watch(shownNodeId, () => (initialEntries.value = plotEntries.value), { immediate: true })

const xAxis = computed(() => {
  const voi = store.results?.voi
  return { label: voi?.name.split('/').pop() ?? '', unit: voi?.unit ?? '', values: voi?.values ?? new Float64Array() }
})

// One chart per unit, since one axis can't carry two; a series keeps its colour while it stays plotted.
const charts = computed(() => {
  const previousSlots = store.getSeriesSlots()
  if (!store.results || !shownNode.value) return []
  const byUnit = new Map()
  for (const { name } of plotEntries.value) {
    const series = readNodeSeries(store.results, store.mapping, shownNode.value.id, name)
    if (!series) continue
    const unit = series.unit || 'dimensionless'
    if (!byUnit.has(unit)) byUnit.set(unit, [])
    byUnit.get(unit).push({ key: `${unit}::${name}`, label: name, values: series.values })
  }

  const nextSlots = new Map()
  const result = []
  for (const [unit, unitSeries] of byUnit) {
    const groups = chunkSeries(unitSeries)
    groups.forEach((group, index) => {
      const slots = assignSeriesSlots(previousSlots, group.map((series) => series.key))
      slots.forEach((slot, key) => nextSlots.set(key, slot))
      result.push({
        key: `${unit}#${index}`,
        title: group.map((series) => series.label).join(', '),
        unit,
        series: group.map((series) => ({ ...series, slot: slots.get(series.key) })),
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

.panel-picker {
  height: 300px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
