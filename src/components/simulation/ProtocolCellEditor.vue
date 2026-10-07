<template>
  <div class="cell-editor">
    <SelectButton v-model="kind" :options="KINDS" option-label="label" option-value="value" size="small" :allow-empty="false" aria-label="How it varies" />

    <div v-if="kind === 'number'" class="cell-fields">
      <label>Value <InputNumber v-model="fields.value" :max-fraction-digits="8" size="small" /></label>
    </div>
    <div v-else-if="kind === 'trace'" class="cell-fields cell-fields--trace">
      <Select
        v-if="traceNames.length"
        v-model="traceName"
        :options="traceNames"
        placeholder="A trace in the file…"
        size="small"
        aria-label="A trace in the file"
      />
      <label class="csv-button">
        <i class="pi pi-upload" aria-hidden="true"></i>
        Import a CSV of time and value
        <input type="file" accept=".csv,text/csv,text/plain" class="visually-hidden" @change="readCsv" />
      </label>
      <span v-if="importedTrace" class="subtle">{{ importedTrace.t.length }} points from {{ importedTrace.t[0] }} to {{ importedTrace.t.at(-1) }}</span>
      <Message v-if="csvProblem" severity="error" size="small">{{ csvProblem }}</Message>
    </div>
    <div v-else class="cell-fields">
      <label v-for="field in FORM_FIELDS[kind]" :key="field.key">
        {{ field.label }}
        <InputNumber v-model="fields[field.key]" :min="field.min" :max-fraction-digits="8" size="small" />
      </label>
    </div>

    <p v-if="canAlign" class="align-note">
      Circulatory autogen starts this with the warm-up, so it runs {{ preTime }} earlier than written.
      <Button label="Start it with the sub-experiment" link size="small" @click="emit('align')" />
    </p>

    <div class="cell-actions">
      <Button label="Cancel" text size="small" severity="secondary" @click="emit('cancel')" />
      <Button label="Apply" size="small" :disabled="!canApply" @click="apply" />
    </div>
  </div>
</template>

<script setup>
/**
 * Edits how a protocol's parameter varies over one sub-experiment: a number, a step, a pulse, pacing, a ramp, or a
 * trace from the file or a CSV.
 */
import { computed, reactive, ref } from 'vue'
import Papa from 'papaparse'

import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import Message from 'primevue/message'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'

import { buildShapeFromForm } from '../../services/protocol/protocolModel'

const KINDS = [
  { value: 'number', label: 'Number' },
  { value: 'step', label: 'Step' },
  { value: 'pulse', label: 'Pulse' },
  { value: 'pacing', label: 'Pacing' },
  { value: 'ramp', label: 'Ramp' },
  { value: 'trace', label: 'Trace' },
]
const FORM_FIELDS = {
  step: [
    { key: 'baseline', label: 'Before' },
    { key: 'level', label: 'After' },
    { key: 'start', label: 'At', min: 0 },
  ],
  pulse: [
    { key: 'baseline', label: 'Baseline' },
    { key: 'level', label: 'Level' },
    { key: 'start', label: 'From', min: 0 },
    { key: 'end', label: 'To', min: 0 },
  ],
  pacing: [
    { key: 'baseline', label: 'Baseline' },
    { key: 'level', label: 'Level' },
    { key: 'start', label: 'First at', min: 0 },
    { key: 'length', label: 'Each lasting', min: 0 },
    { key: 'period', label: 'Every', min: 0 },
    { key: 'multiplier', label: 'Times (0: to the end)', min: 0 },
  ],
  ramp: [
    { key: 'from', label: 'From' },
    { key: 'to', label: 'To' },
  ],
}

const props = defineProps({
  // The cell, from readProtocolInfo.
  cell: { type: Object, required: true },
  // The sub-experiment's length.
  duration: { type: Number, required: true },
  // The traces the file has, by name.
  traceNames: { type: Array, default: () => [] },
  // The experiment's warm-up, when this input starts with it.
  preTime: { type: Number, default: 0 },
  canAlign: { type: Boolean, default: false },
})
const emit = defineEmits(['apply', 'align', 'cancel'])

const startValue = props.cell.kind === 'constant' ? props.cell.value : 0
const form = props.cell.form
const kind = ref(props.cell.kind === 'constant' ? 'number' : props.cell.kind === 'trace' || !form ? 'trace' : form.type)
// Every kind's fields at once, so switching kinds keeps what was typed; the defaults are CUFLynx's.
const fields = reactive({
  value: startValue,
  baseline: form?.baseline ?? startValue,
  level: form?.level ?? 1,
  start: form?.start ?? props.duration / 2,
  end: form?.end ?? (props.duration * 3) / 4,
  length: form?.length ?? props.duration / 100,
  period: form?.period ?? props.duration / 10,
  multiplier: form?.multiplier ?? 0,
  from: form?.from ?? startValue,
  to: form?.to ?? startValue,
})
const traceName = ref(props.cell.kind === 'trace' ? props.cell.name : null)
const importedTrace = ref(null)
const csvProblem = ref('')

const canApply = computed(() => (kind.value === 'trace' ? !!(importedTrace.value || traceName.value) : true))

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
  if (kind.value === 'number') emit('apply', { value: fields.value ?? 0 })
  else if (kind.value === 'trace') emit('apply', importedTrace.value ? { trace: importedTrace.value } : { traceName: traceName.value })
  else emit('apply', { shape: buildShapeFromForm({ type: kind.value, ...fields }, props.duration) })
}
</script>

<style scoped>
.cell-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 34rem;
}

.cell-fields {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
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

.cell-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
</style>
