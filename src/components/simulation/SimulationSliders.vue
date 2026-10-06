<template>
  <section class="simulation-sliders" aria-label="Parameter sliders">
    <h5 class="sliders-title">Parameters</h5>

    <div v-for="slider in sliders" :key="slider.key" class="slider-row">
      <div class="slider-head">
        <span class="slider-name">{{ slider.parameterName }}</span>
        <span class="slider-value" :class="{ 'slider-value--changed': slider.isChanged }">
          {{ formatValue(slider.value) }} {{ slider.units }}
        </span>
        <Button
          icon="pi pi-undo"
          text
          rounded
          size="small"
          :disabled="!slider.isChanged"
          :aria-label="`Reset ${slider.parameterName}`"
          v-tooltip.top="'Back to the model’s value'"
          @click="setValue(slider, null)"
        />
        <Button
          icon="pi pi-check"
          text
          rounded
          size="small"
          :disabled="!slider.isChanged"
          :aria-label="`Apply ${slider.parameterName} to the model`"
          v-tooltip.top="'Apply this value to the model'"
          @click="applyToModel(slider)"
        />
        <Button
          icon="pi pi-times"
          text
          rounded
          size="small"
          severity="secondary"
          :aria-label="`Remove the ${slider.parameterName} slider`"
          v-tooltip.top="'Remove slider'"
          @click="removeSliderFor(slider)"
        />
      </div>
      <Slider
        v-if="slider.hasRange"
        :model-value="toPosition(slider)"
        :min="0"
        :max="POSITIONS"
        :step="slider.positionStep"
        :aria-label="`${slider.parameterName} value`"
        :aria-valuetext="`${formatValue(slider.value)} ${slider.units}`"
        class="slider-control"
        @update:model-value="(position) => setValue(slider, fromPosition(slider, position))"
      />
      <div class="slider-range">
        <InputNumber
          :model-value="slider.min"
          :max-fraction-digits="6"
          size="small"
          :aria-label="`${slider.parameterName} minimum`"
          @update:model-value="(min) => updateRange(slider, { min })"
        />
        <span aria-hidden="true">to</span>
        <InputNumber
          :model-value="slider.max"
          :max-fraction-digits="6"
          size="small"
          :aria-label="`${slider.parameterName} maximum`"
          @update:model-value="(max) => updateRange(slider, { max })"
        />
      </div>
    </div>

    <Select
      :model-value="null"
      :options="addableRows"
      option-label="name"
      placeholder="Add a slider…"
      filter
      size="small"
      class="slider-add"
      aria-label="Add a slider"
      @update:model-value="addSlider"
    />
  </section>
</template>

<script setup>
/**
 * Sliders for an instance's parameters. A slider's value is tried out in runs without changing the model
 * until it is applied; moving one asks for a run after a short pause.
 */
import { computed, onBeforeUnmount } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import Slider from 'primevue/slider'

import { useNodeDataHistory } from '../../composables/useNodeDataHistory'
import {
  createSliderDefinition,
  isSlidableRow,
  pickDefaultValue,
  putSlider,
  removeSlider,
  sliderValueKey,
} from '../../services/simulation/parameterSliders'
import { useLibraryStore } from '../../stores/libraryStore'
import { useSimulationResultsStore } from '../../stores/simulationResultsStore'
import { useSimulationSettingsStore } from '../../stores/simulationSettingsStore'
import { FLOW_IDS } from '../../utils/constants'

const RERUN_DELAY_MS = 300
// The slider moves over whole positions across the range, since its fractional steps are unreliable.
const POSITIONS = 1000

const props = defineProps({
  node: { type: Object, required: true },
  // Makes a change that keeps the shown results true (see useSimulation).
  keepCurrent: { type: Function, default: (change) => change() },
})
const emit = defineEmits(['change'])

const libraryStore = useLibraryStore()
const resultsStore = useSimulationResultsStore()
const settingsStore = useSimulationSettingsStore()
const { updateNodeData } = useVueFlow(FLOW_IDS.MAIN)
const { recordEdit } = useNodeDataHistory(FLOW_IDS.MAIN)

const allDefinitions = computed(() => settingsStore.parameterScanConfig?.selections ?? [])
const definitions = computed(() => allDefinitions.value.filter((definition) => definition.nodeId === props.node.id))

// Sliders whose variable is still a slidable row; one renamed or retyped since is left out.
const sliders = computed(() =>
  definitions.value.flatMap((definition) => {
    const row = props.node.data.variables?.find((candidate) => candidate.name === definition.parameterName)
    if (!isSlidableRow(row)) return []
    const hasRange = Number.isFinite(definition.min) && Number.isFinite(definition.max) && definition.max > definition.min
    const valueKey = sliderValueKey(definition)
    const override = resultsStore.sliderValues.get(valueKey)
    const positionStep = definition.step && hasRange ? Math.max(1, Math.round((definition.step / (definition.max - definition.min)) * POSITIONS)) : 1
    return [
      {
        ...definition,
        valueKey,
        hasRange,
        positionStep,
        // Unchanged, a slider shows the model's value as runs use it.
        value: override ?? pickDefaultValue(row, libraryStore.getGlobalConstant),
        isChanged: override !== undefined,
      },
    ]
  })
)

const addableRows = computed(() => {
  const defined = new Set(definitions.value.map((definition) => definition.parameterName))
  return (props.node.data.variables ?? []).filter((row) => isSlidableRow(row) && !defined.has(row.name))
})

let rerunTimer = null
onBeforeUnmount(() => {
  // A run still waited for is asked for now, so a slider moved just before leaving still counts.
  if (rerunTimer) emit('change')
  clearTimeout(rerunTimer)
})

/** Asks for a run once the sliders have been still for a moment. */
function scheduleRerun() {
  clearTimeout(rerunTimer)
  rerunTimer = setTimeout(() => {
    rerunTimer = null
    emit('change')
  }, RERUN_DELAY_MS)
}

/**
 * Checks whether another slider shares a slider's value, as sliders on one global constant do.
 *
 * @param {Object} definition
 * @returns {boolean}
 */
const isValueShared = (definition) =>
  allDefinitions.value.some((other) => other.key !== definition.key && sliderValueKey(other) === sliderValueKey(definition))

/**
 * Gets a slider's position for its value.
 *
 * @param {Object} slider
 * @returns {number}
 */
const toPosition = (slider) => Math.round(((slider.value - slider.min) / (slider.max - slider.min)) * POSITIONS)

/**
 * Gets the value at a slider position, rounded to its step when it has one, and to 6 significant figures.
 *
 * @param {Object} slider
 * @param {number} position
 * @returns {number}
 */
function fromPosition(slider, position) {
  const value = slider.min + (position / POSITIONS) * (slider.max - slider.min)
  const stepped = slider.step ? slider.min + Math.round((value - slider.min) / slider.step) * slider.step : value
  return Number(stepped.toPrecision(6))
}

/**
 * Formats a slider value compactly.
 *
 * @param {number|null} value
 * @returns {string}
 */
const formatValue = (value) => (Number.isFinite(value) ? Number(value.toPrecision(4)).toString() : '–')

/**
 * Sets a slider's value, or puts it back to the model's with null, and asks for a run.
 *
 * @param {Object} slider
 * @param {number|null} value
 */
function setValue(slider, value) {
  if (value !== null && value === slider.value) return
  resultsStore.setSliderValue(slider.valueKey, value)
  scheduleRerun()
}

/**
 * Adds a slider for a row.
 *
 * @param {Object|null} row
 */
function addSlider(row) {
  if (!row) return
  const definition = createSliderDefinition(props.node, row, libraryStore.getGlobalConstant)
  // A new slider starts at the model's value, unless it joins a global constant's shared slider.
  if (!isValueShared(definition)) resultsStore.setSliderValue(sliderValueKey(definition), null)
  settingsStore.setParameterScanConfig(putSlider(settingsStore.parameterScanConfig, definition))
}

/**
 * Removes a slider, and its value from runs.
 *
 * @param {Object} slider
 */
function removeSliderFor(slider) {
  const wasApplied = slider.isChanged && !isValueShared(slider)
  if (!isValueShared(slider)) resultsStore.setSliderValue(slider.valueKey, null)
  settingsStore.setParameterScanConfig(removeSlider(settingsStore.parameterScanConfig, slider.key))
  if (wasApplied) scheduleRerun()
}

/**
 * Changes a slider's range.
 *
 * @param {Object} slider
 * @param {{min?: number, max?: number}} range
 */
function updateRange(slider, range) {
  const definition = definitions.value.find((candidate) => candidate.key === slider.key)
  settingsStore.setParameterScanConfig(putSlider(settingsStore.parameterScanConfig, { ...definition, ...range }))
}

/**
 * Writes a slider's value into the model as one undoable edit, so it becomes the model's value. The
 * slider's exported default follows it.
 *
 * @param {Object} slider
 */
function applyToModel(slider) {
  const value = String(slider.value)
  props.keepCurrent(() => {
    if (slider.type === 'global_constant') {
      const shared = libraryStore.getGlobalConstant(slider.parameterName)
      recordEdit({
        type: 'apply-slider',
        nodeIds: [],
        keys: [],
        apply: () => libraryStore.assignGlobalConstant(slider.parameterName, value, shared?.units ?? slider.units, shared?.data_reference ?? null, true),
      })
    } else {
      const variables = props.node.data.variables.map((row) => (row.name === slider.parameterName ? { ...row, value } : row))
      recordEdit({
        type: 'apply-slider',
        nodeIds: [props.node.id],
        keys: ['variables'],
        apply: () => updateNodeData(props.node.id, { variables }),
      })
    }
    const definition = definitions.value.find((candidate) => candidate.key === slider.key)
    settingsStore.setParameterScanConfig(putSlider(settingsStore.parameterScanConfig, { ...definition, default: slider.value }))
    resultsStore.setSliderValue(slider.valueKey, null)
  })
}
</script>

<style scoped>
.simulation-sliders {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sliders-title {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--p-text-color);
}

.slider-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.slider-head {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 0.8125rem;
}

.slider-name {
  font-weight: 600;
  color: var(--p-text-color);
}

.slider-value {
  margin-left: auto;
  margin-right: 4px;
  font-variant-numeric: tabular-nums;
  color: var(--p-text-muted-color);
}

.slider-value--changed {
  color: var(--p-primary-color);
  font-weight: 600;
}

.slider-control {
  margin: 0 8px;
}

.slider-range {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.slider-range :deep(.p-inputnumber-input) {
  width: 100%;
  min-width: 0;
}

.slider-add {
  width: 100%;
}
</style>
