<template>
  <form class="cell-editor" @submit.prevent="apply">
    <header class="cell-header">
      <span class="cell-parameter">{{ parameter }}</span>
      <span class="cell-where">Sub-experiment {{ sub + 1 }} · {{ formatNumber(duration) }} s{{ units ? ` · ${units}` : '' }}</span>
    </header>

    <SelectButton v-model="kind" :options="INPUT_KINDS" option-label="label" option-value="value" size="small" :allow-empty="false" class="kind-picker" aria-label="How it varies">
      <template #option="{ option }">
        <svg class="kind-glyph" viewBox="0 0 16 10" aria-hidden="true"><polyline :points="option.glyph" /></svg>
        <span>{{ option.label }}</span>
      </template>
    </SelectButton>

    <div class="preview" :class="{ 'preview--problem': problem }">
      <svg v-if="preview" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
        <polyline :points="preview.points" :stroke="colour" />
      </svg>
      <span v-if="preview" class="preview-scale preview-scale--high">{{ formatNumber(preview.high) }}</span>
      <span v-if="preview" class="preview-scale preview-scale--low">{{ formatNumber(preview.low) }}</span>
      <span class="preview-time preview-time--start">0 s</span>
      <span class="preview-time preview-time--end">{{ formatNumber(duration) }} s</span>
    </div>

    <div v-if="kind === 'number'" class="cell-fields">
      <label>Value <InputNumber v-model="fields.value" :max-fraction-digits="8" size="small" fluid autofocus /></label>
    </div>
    <div v-else-if="kind === 'trace'" class="cell-fields cell-fields--trace">
      <Select
        v-if="traceNames.length"
        v-model="traceName"
        :options="traceNames"
        placeholder="A trace in the file…"
        size="small"
        aria-label="A trace in the file"
        @update:model-value="importedTrace = null"
      />
      <label class="csv-button">
        <i class="pi pi-upload" aria-hidden="true"></i>
        Import a CSV of time and value
        <input type="file" accept=".csv,text/csv,text/plain" class="visually-hidden" @change="readCsv" />
      </label>
      <span v-if="importedTrace" class="subtle">{{ importedTrace.t.length }} points from {{ importedTrace.t[0] }} to {{ importedTrace.t.at(-1) }}</span>
    </div>
    <div v-else class="cell-fields">
      <label v-for="(field, position) in FORM_FIELDS[kind]" :key="field.key">
        {{ field.label }}
        <InputNumber
          v-model="fields[field.key]"
          :min="field.min"
          :max-fraction-digits="8"
          :suffix="field.isTime ? ' s' : undefined"
          size="small"
          fluid
          :autofocus="position === 0"
        />
      </label>
    </div>

    <Message v-if="problem" severity="error" size="small">{{ problem }}</Message>

    <p v-if="canAlign" class="align-note">
      <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
      Circulatory autogen starts this with the warm-up, so it runs {{ formatNumber(preTime) }} s earlier than written.
      <Button label="Start it with the sub-experiment" link size="small" @click="emit('align')" />
    </p>

    <div class="cell-actions">
      <Button label="Cancel" text size="small" severity="secondary" @click="emit('cancel')" />
      <Button type="submit" label="Apply" size="small" :disabled="!canApply" />
    </div>
  </form>
</template>

<script setup>
/**
 * Edits how a protocol's parameter varies over one sub-experiment: a number, a step, a pulse, pacing, a ramp, or a
 * trace from the file or a CSV, drawn as CA would run it as it is typed.
 */
import { computed, reactive, ref } from 'vue'
import Papa from 'papaparse'

import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import Message from 'primevue/message'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'

import { INPUT_KINDS } from './protocolKinds'
import { buildShapeFromForm } from '../../services/protocol/protocolModel'
import { findValueRange, sampleInput, writePolylinePoints } from '../../services/protocol/protocolPreview'
import { expandShape, normaliseShape } from '../../services/protocol/protocolShapes'

const FORM_FIELDS = {
  step: [
    { key: 'baseline', label: 'Before' },
    { key: 'level', label: 'After' },
    { key: 'start', label: 'At', min: 0, isTime: true },
  ],
  pulse: [
    { key: 'baseline', label: 'Baseline' },
    { key: 'level', label: 'Level' },
    { key: 'start', label: 'From', min: 0, isTime: true },
    { key: 'end', label: 'To', min: 0, isTime: true },
  ],
  pacing: [
    { key: 'baseline', label: 'Baseline' },
    { key: 'level', label: 'Level' },
    { key: 'start', label: 'First at', min: 0, isTime: true },
    { key: 'length', label: 'Each lasting', min: 0, isTime: true },
    { key: 'period', label: 'Every', min: 0, isTime: true },
    { key: 'multiplier', label: 'Times (0: to the end)', min: 0 },
  ],
  ramp: [
    { key: 'from', label: 'From' },
    { key: 'to', label: 'To' },
  ],
}

const props = defineProps({
  parameter: { type: String, required: true },
  sub: { type: Number, required: true },
  // The cell, from readProtocolInfo.
  cell: { type: Object, required: true },
  // The kind of input to start on, when not the cell's own, as chosen from its segment's menu.
  initialKind: { type: String, default: null },
  // The sub-experiment's length.
  duration: { type: Number, required: true },
  // The traces the file has, by name.
  traces: { type: Object, default: () => ({}) },
  units: { type: String, default: '' },
  colour: { type: String, default: 'currentColor' },
  // The experiment's warm-up, when this input starts with it.
  preTime: { type: Number, default: 0 },
  canAlign: { type: Boolean, default: false },
})
const emit = defineEmits(['apply', 'align', 'cancel'])

const startValue = props.cell.kind === 'constant' ? props.cell.value : 0
const form = props.cell.form
const kind = ref(props.initialKind ?? (props.cell.kind === 'constant' ? 'number' : props.cell.kind === 'trace' || !form ? 'trace' : form.type))
// Every kind's fields at once, so switching kinds keeps what was typed; the defaults are CUFLynx's.
const fields = reactive({
  value: startValue,
  baseline: form?.baseline ?? startValue,
  level: form?.level ?? (startValue * 2 || 1),
  start: form?.start ?? props.duration / 4,
  end: form?.end ?? props.duration / 2,
  length: form?.length ?? props.duration / 100,
  period: form?.period ?? props.duration / 10,
  multiplier: form?.multiplier ?? 0,
  from: form?.from ?? startValue,
  to: form?.to ?? (startValue * 2 || 1),
})
const traceNames = computed(() => Object.keys(props.traces))
const traceName = ref(props.cell.kind === 'trace' ? props.cell.name : null)
const importedTrace = ref(null)
const csvProblem = ref('')

/**
 * Formats a number shortly.
 *
 * @param {number} value
 * @returns {string}
 */
const formatNumber = (value) => (Number.isFinite(value) ? String(Number(value.toPrecision(4))) : '–')

// The edit as it stands: `{ value }`, `{ shape }` or a trace, with CA's reason when it would refuse it.
const draft = computed(() => {
  if (kind.value === 'number') return Number.isFinite(fields.value) ? { value: fields.value } : { problem: 'The value needs a number.' }
  if (kind.value === 'trace') {
    if (importedTrace.value) return { trace: importedTrace.value }
    if (traceName.value && props.traces[traceName.value]) return { traceName: traceName.value, preview: props.traces[traceName.value] }
    return { problem: csvProblem.value || null }
  }
  const shape = buildShapeFromForm({ type: kind.value, ...fields }, props.duration)
  try {
    return { shape, preview: expandShape(normaliseShape(shape, 'input'), props.duration, 'input') }
  } catch (error) {
    // CA's own words, less the name it gives the shape.
    return { problem: error.message.replace(/protocol_shapes\['input'\](\.events\[0\])?/g, 'The input') }
  }
})
const problem = computed(() => draft.value.problem ?? null)
const canApply = computed(() => !draft.value.problem && Object.keys(draft.value).some((key) => ['value', 'shape', 'trace', 'traceName'].includes(key)))

// The input over the sub-experiment, as CA would run it.
const preview = computed(() => {
  const { value, preview: trace, trace: imported } = draft.value
  const cell = value !== undefined ? { kind: 'constant', value } : trace || imported ? { kind: 'trace', trace: trace ?? imported } : null
  const sample = cell && sampleInput(cell, 0, props.duration)
  if (!sample) return null
  const { low, high } = findValueRange([sample])
  return { low, high, points: writePolylinePoints(sample, { from: 0, to: props.duration, low, high, width: 100, height: 40 }) }
})

/**
 * Reads a CSV of times and values, with or without a header row, as a trace.
 *
 * @param {Event} event - The file input's change.
 */
async function readCsv(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const { data } = Papa.parse((await file.text()).trim(), { dynamicTyping: true, skipEmptyLines: true })
  const rows = data.filter((row) => Number.isFinite(row[0]) && Number.isFinite(row[1]))
  const isIncreasing = rows.every((row, i) => i === 0 || row[0] > rows[i - 1][0])
  if (rows.length < 2 || !isIncreasing) {
    importedTrace.value = null
    csvProblem.value = 'The file needs two columns, time and value, with at least two rows and times that only increase.'
    return
  }
  csvProblem.value = ''
  importedTrace.value = { t: rows.map((row) => row[0]), values: rows.map((row) => row[1]) }
  traceName.value = null
}

/** Applies the edit: `{value}`, `{shape}`, `{trace}` or `{traceName}`. */
function apply() {
  if (!canApply.value) return
  const { value, shape, trace, traceName: name } = draft.value
  emit('apply', shape ? { shape } : trace ? { trace } : name ? { traceName: name } : { value })
}
</script>

<style scoped>
.cell-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 32rem;
  max-width: 90vw;
}

.kind-picker {
  display: flex;
}

.kind-picker :deep(.p-togglebutton) {
  flex: 1;
}

.kind-picker :deep(.p-togglebutton-content) {
  gap: 5px;
}

.kind-glyph {
  flex-shrink: 0;
  width: 16px;
  height: 10px;
}

.kind-glyph polyline {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linejoin: round;
}

.cell-header {
  display: flex;
  flex-direction: column;
}

.cell-parameter {
  font-weight: 600;
}

.cell-where {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.preview {
  position: relative;
  height: 5.5rem;
  border-radius: 6px;
  background: var(--p-content-hover-background);
}

.preview--problem {
  opacity: 0.45;
}

.preview svg {
  position: absolute;
  inset: 8px 8px 16px 44px;
  width: calc(100% - 52px);
  height: calc(100% - 24px);
}

.preview polyline {
  fill: none;
  stroke-width: 2;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.preview-scale,
.preview-time {
  position: absolute;
  font-size: 0.6875rem;
  color: var(--p-text-muted-color);
  font-variant-numeric: tabular-nums;
}

.preview-scale {
  left: 6px;
  width: 34px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-scale--high {
  top: 8px;
}

.preview-scale--low {
  bottom: 16px;
}

.preview-time {
  bottom: 1px;
}

.preview-time--start {
  left: 44px;
}

.preview-time--end {
  right: 8px;
}

.cell-fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
  gap: 8px;
}

.cell-fields label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.8125rem;
}

.cell-fields--trace {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.csv-button {
  cursor: pointer;
  color: var(--p-primary-color);
  flex-direction: row !important;
  align-items: center;
}

.subtle {
  color: var(--p-text-muted-color);
  font-size: 0.8125rem;
}

.align-note {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--p-text-muted-color);
}

.align-note .pi {
  color: var(--p-orange-500);
}

.cell-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
</style>
