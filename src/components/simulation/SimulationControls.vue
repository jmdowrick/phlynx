<template>
  <section class="simulation-controls" aria-label="What gets plotted and tried out">
    <SelectButton
      v-model="view"
      :options="views"
      option-label="label"
      option-value="value"
      :allow-empty="false"
      size="small"
      class="controls-views"
      aria-label="Show"
    />

    <template v-if="view === 'plots'">
      <div class="controls-search">
        <VariablePathPicker
          ref="plotPicker"
          :index="index"
          :filter="(entry) => entry.plottable"
          :describe="describePlottable"
          placeholder="Add a variable…"
          aria-label="Add a variable to plot"
          @pick="plotEntry"
        />
        <Select
          v-model="targetPlotId"
          :options="plotOptions"
          option-label="name"
          option-value="id"
          size="small"
          class="controls-target"
          aria-label="Plot to add to"
        />
      </div>
      <PlotListEditor
        v-model:target-plot-id="targetPlotId"
        :plot-config="settingsStore.plotConfig"
        :nodes="nodes"
        :scope-node-ids="scopeNodeIds"
        :series-slots="resultsStore.getSeriesSlots()"
        @update:plot-config="settingsStore.setPlotConfig"
        @add-here="focusPicker"
      />
    </template>

    <template v-else>
      <VariablePathPicker
        :index="index"
        :filter="(entry) => entry.slidable && !sliderKeys.has(entry.key)"
        :describe="describeSlidable"
        placeholder="Add a slider…"
        aria-label="Add a slider"
        @pick="addSlider"
      />
      <SliderList :nodes="nodes" :scope-node-ids="scopeNodeIds" :keep-current="keepCurrent" @change="emit('change')" />
    </template>
  </section>
</template>

<script setup>
/**
 * What gets plotted and tried out, across the whole model: plots and the variables on them, or parameter
 * sliders, each added from one search over every `instance/variable` path.
 */
import { computed, ref, watch } from 'vue'

import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'

import PlotListEditor from './PlotListEditor.vue'
import SliderList from './SliderList.vue'
import VariablePathPicker from './VariablePathPicker.vue'
import { createSliderDefinition, putSlider, sliderValueKey } from '../../services/simulation/parameterSliders'
import { addPlotSelection, resolveGroups } from '../../services/simulation/plotSelections'
import { buildVariableIndex } from '../../services/simulation/variableIndex'
import { useLibraryStore } from '../../stores/libraryStore'
import { useSimulationResultsStore } from '../../stores/simulationResultsStore'
import { useSimulationSettingsStore } from '../../stores/simulationSettingsStore'

const props = defineProps({
  // Every node in the workspace: any of them can be plotted or given a slider.
  nodes: { type: Array, default: () => [] },
  // The nodes the last run simulated, or null for all of them.
  scopeNodeIds: { type: Array, default: null },
  // Makes a change that keeps the shown results true (see useSimulation).
  keepCurrent: { type: Function, default: (change) => change() },
})
// A slider moved, so the scope wants running again.
const emit = defineEmits(['change'])

const libraryStore = useLibraryStore()
const resultsStore = useSimulationResultsStore()
const settingsStore = useSimulationSettingsStore()

const view = ref('plots')
const targetPlotId = ref(null)
const plotPicker = ref(null)

const index = computed(() => buildVariableIndex(props.nodes, { scopeNodeIds: props.scopeNodeIds, mapping: resultsStore.mapping }))
const plotOptions = computed(() => resolveGroups(settingsStore.plotConfig))
const plottedCount = computed(() => settingsStore.plotConfig?.selections?.length ?? 0)
const sliderDefinitions = computed(() => settingsStore.parameterScanConfig?.selections ?? [])
const sliderKeys = computed(() => new Set(sliderDefinitions.value.map((definition) => sliderValueKey(definition))))
const views = computed(() => [
  { label: `Plots (${plottedCount.value})`, value: 'plots' },
  { label: `Sliders (${sliderKeys.value.size})`, value: 'sliders' },
])

// The target is the plot chosen last, or the first while that one is gone.
watch(
  plotOptions,
  (plots) => {
    if (!plots.some((plot) => plot.id === targetPlotId.value)) targetPlotId.value = plots[0]?.id ?? null
  },
  { immediate: true }
)

const nodesById = computed(() => new Map(props.nodes.map((node) => [node.id, node])))
const plotNames = computed(() => new Map(plotOptions.value.map((plot) => [plot.id, plot.name])))
const plottedGroups = computed(() => new Map((settingsStore.plotConfig?.selections ?? []).map((selection) => [selection.key, selection.groupId])))

/**
 * Notes where a variable is plotted and what it is the same as.
 *
 * @param {Object} entry
 * @returns {string|null}
 */
function describePlottable(entry) {
  const notes = []
  if (plottedGroups.value.has(entry.key)) notes.push(`On ${plotNames.value.get(plottedGroups.value.get(entry.key)) ?? 'no plot'}`)
  if (!entry.inScope) notes.push('Not in the last run')
  if (entry.equivalents.length) notes.push(`≡ ${entry.equivalents.join(', ')}`)
  return notes.length ? notes.join(' · ') : null
}

/**
 * Notes a parameter's value and what it is the same as.
 *
 * @param {Object} entry
 * @returns {string|null}
 */
function describeSlidable(entry) {
  const notes = []
  if (!entry.inScope) notes.push('Not in the last run')
  if (entry.equivalents.length) notes.push(`≡ ${entry.equivalents.join(', ')}`)
  return notes.length ? notes.join(' · ') : null
}

/**
 * Finds the node and row an index entry names.
 *
 * @param {Object} entry
 * @returns {{node: Object, row: Object}|null}
 */
function resolveEntry(entry) {
  const node = nodesById.value.get(entry.nodeId)
  const row = node?.data?.variables?.find((candidate) => candidate.name === entry.rowName)
  return node && row ? { node, row } : null
}

/**
 * Plots a picked variable on the target plot, moving it there if it is on another.
 *
 * @param {Object} entry
 */
function plotEntry(entry) {
  const found = resolveEntry(entry)
  if (!found) return
  settingsStore.setPlotConfig(addPlotSelection(settingsStore.plotConfig, found.node, found.row, targetPlotId.value))
}

/**
 * Adds a slider for a picked parameter, starting at the model's value unless it joins a global
 * constant's shared slider.
 *
 * @param {Object} entry
 */
function addSlider(entry) {
  const found = resolveEntry(entry)
  if (!found) return
  const definition = createSliderDefinition(found.node, found.row, libraryStore.getGlobalConstant)
  const valueKey = sliderValueKey(definition)
  if (!sliderDefinitions.value.some((other) => sliderValueKey(other) === valueKey)) resultsStore.setSliderValue(valueKey, null)
  settingsStore.setParameterScanConfig(putSlider(settingsStore.parameterScanConfig, definition))
}

/** Puts the cursor in the search box, for a plot's add button. */
function focusPicker() {
  plotPicker.value?.$el?.querySelector('input')?.focus()
}
</script>

<style scoped>
.simulation-controls {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.controls-views {
  align-self: flex-start;
}

.controls-search {
  display: flex;
  gap: 6px;
  min-width: 0;
}

.controls-search > :first-child {
  flex: 1;
  min-width: 0;
}

.controls-target {
  flex-shrink: 0;
  width: 7.5rem;
}

/* Narrow: the plot to add to goes under the search box. */
@container (max-width: 300px) {
  .controls-search {
    flex-direction: column;
  }

  .controls-target {
    width: 100%;
  }
}
</style>
