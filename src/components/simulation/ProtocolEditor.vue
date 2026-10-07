<template>
  <section class="protocol-editor">
    <div v-if="!protocolInfo" class="protocol-empty">
      <p>No protocol yet. A protocol runs the model as experiments, each a series of sub-experiments that set parameters.</p>
      <Button label="Create a protocol" icon="pi pi-plus" size="small" @click="emitDocument(ensureProtocol(document))" />
    </div>

    <template v-else>
      <div class="experiment-bar" role="toolbar" aria-label="Experiments">
        <Button
          v-for="(experiment, index) in view.experiments"
          :key="index"
          :label="experiment.label ?? `Experiment ${index + 1}`"
          size="small"
          :severity="index === current ? 'primary' : 'secondary'"
          :outlined="index !== current"
          :aria-pressed="index === current"
          @click="selected = index"
        />
        <Button icon="pi pi-plus" text rounded size="small" aria-label="Add an experiment, a copy of this one" v-tooltip.bottom="'Add an experiment, a copy of this one'" @click="addExperimentCopy" />
        <span class="bar-spacer"></span>
        <Button icon="pi pi-arrow-left" text rounded size="small" severity="secondary" :disabled="current === 0" aria-label="Move this experiment earlier" @click="moveSelected(-1)" />
        <Button icon="pi pi-arrow-right" text rounded size="small" severity="secondary" :disabled="current === view.experiments.length - 1" aria-label="Move this experiment later" @click="moveSelected(1)" />
        <Button icon="pi pi-trash" text rounded size="small" severity="secondary" :disabled="view.experiments.length < 2" aria-label="Remove this experiment" @click="removeSelected" />
      </div>

      <div class="experiment-fields">
        <label class="field">
          <span>Name</span>
          <InputText :model-value="experiment.label ?? ''" :placeholder="`Experiment ${current + 1}`" size="small" aria-label="Experiment name" @change="(event) => edit(setTiming, { experiment: current, label: event.target.value })" />
        </label>
        <label class="field">
          <span v-tooltip.bottom="'Run before the first sub-experiment, unplotted, to let the model settle'">Warm-up</span>
          <InputNumber
            :model-value="experiment.preTime"
            :min="0"
            :max-fraction-digits="8"
            size="small"
            aria-label="Warm-up"
            @update:model-value="(value) => value != null && edit(setTiming, { experiment: current, preTime: value })"
          />
        </label>
      </div>

      <div class="table-scroll">
        <table class="protocol-table">
          <thead>
            <tr>
              <th scope="col">Parameter</th>
              <th v-for="(sub, s) in experiment.subs" :key="s" scope="col" class="sub-header">
                <div class="sub-title">
                  <span>Sub-experiment {{ s + 1 }}</span>
                  <Button
                    v-if="experiment.subs.length > 1"
                    icon="pi pi-times"
                    text
                    rounded
                    size="small"
                    severity="secondary"
                    :aria-label="`Remove sub-experiment ${s + 1}`"
                    @click="removeSub(s)"
                  />
                </div>
              </th>
              <th scope="col">
                <Button icon="pi pi-plus" text rounded size="small" aria-label="Add a sub-experiment" v-tooltip.bottom="'Add a sub-experiment'" @click="edit(addSubExperiment, current)" />
              </th>
            </tr>
            <tr>
              <th scope="row" class="length-label">Length</th>
              <td v-for="(sub, s) in experiment.subs" :key="s">
                <InputNumber
                  :model-value="sub.duration"
                  :min="0"
                  :max-fraction-digits="8"
                  size="small"
                  fluid
                  :aria-label="`Sub-experiment ${s + 1} length`"
                  @update:model-value="(value) => value != null && edit(setTiming, { experiment: current, sub: s, duration: value })"
                />
              </td>
              <td></td>
            </tr>
          </thead>
          <tbody>
            <tr v-for="control in view.controls" :key="control.parameter">
              <th scope="row" class="parameter-path" :title="control.parameter">
                <span class="parameter-component">{{ splitPath(control.parameter).component }}/</span><span class="parameter-name">{{ splitPath(control.parameter).name }}</span>
              </th>
              <td v-for="(cell, s) in control.cells[current]" :key="s">
                <InputNumber
                  v-if="cell.kind === 'constant'"
                  :model-value="cell.value"
                  :max-fraction-digits="8"
                  size="small"
                  fluid
                  :aria-label="`${control.parameter} in sub-experiment ${s + 1}`"
                  @update:model-value="(value) => value != null && edit(setValue, { parameter: control.parameter, experiment: current, sub: s, value })"
                />
                <span v-else class="cell-input" :title="cell.name">{{ describeCell(cell) }}</span>
              </td>
              <td>
                <Button
                  icon="pi pi-trash"
                  text
                  rounded
                  size="small"
                  severity="secondary"
                  :aria-label="`Stop setting ${control.parameter}`"
                  @click="edit(removeParameter, control.parameter)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <VariablePathPicker
        :index="index"
        :filter="(entry) => entry.slidable && !setParameters.has(entry.path)"
        placeholder="Add a parameter to set…"
        aria-label="Add a parameter for the protocol to set"
        @pick="addPicked"
      />

      <Message v-for="message in validation.errors" :key="message" severity="error" size="small">{{ message }}</Message>
      <Message v-for="message in validation.warnings" :key="message" severity="warn" size="small">{{ message }}</Message>
    </template>
  </section>
</template>

<script setup>
/**
 * Edits a protocol as circulatory autogen and CUFLynx write it, in an obs_data document: experiments, each a series of
 * sub-experiments, and the value each parameter takes in each. Numbers are edited here; steps, pulses, ramps and
 * traces are shown as they are.
 */
import { computed, ref } from 'vue'

import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'

import VariablePathPicker from './VariablePathPicker.vue'
import { useConfirmDialog } from '../../composables/useConfirmDialog'
import { readObsDataParts } from '../../services/protocol/obsDataDocument'
import {
  addExperiment,
  addParameter,
  addSubExperiment,
  ensureProtocol,
  findObservationsAt,
  moveExperiment,
  removeExperiment,
  removeParameter,
  removeSubExperiment,
  setTiming,
  setValue,
} from '../../services/protocol/protocolEditing'
import { readProtocolInfo } from '../../services/protocol/protocolModel'
import { validateProtocolInfo } from '../../services/protocol/protocolValidation'
import { buildVariableIndex } from '../../services/simulation/variableIndex'

const props = defineProps({
  // The obs_data document, or null when the workspace has none.
  document: { type: [Object, Array], default: null },
  nodes: { type: Array, default: () => [] },
  getGlobalConstant: { type: Function, required: true },
})
const emit = defineEmits(['update:document'])
const { confirm } = useConfirmDialog()

const selected = ref(0)
const index = computed(() => buildVariableIndex(props.nodes))
const protocolInfo = computed(() => (props.document ? readObsDataParts(props.document).protocolInfo : null))
const validation = computed(() => (protocolInfo.value ? validateProtocolInfo(protocolInfo.value) : { errors: [], warnings: [] }))
// Shown as written while it has errors CA would refuse, so it stays editable.
const view = computed(() => readProtocolInfo(validation.value.protocolInfo ?? withDefaults(protocolInfo.value)))
// The experiment shown, kept within the experiments while an edit adding or removing one comes back.
const current = computed(() => Math.min(selected.value, view.value.experiments.length - 1))
const experiment = computed(() => view.value.experiments[current.value])
const setParameters = computed(() => new Set(view.value.controls.map(({ parameter }) => parameter)))


/**
 * Fills in what readProtocolInfo needs of a protocol CA would refuse, so it can still be shown.
 *
 * @param {Object} info
 * @returns {Object}
 */
function withDefaults(info) {
  const simTimes = Array.isArray(info.sim_times) ? info.sim_times.map((subs) => (Array.isArray(subs) ? subs : [])) : [[]]
  const rows = (matrix) => simTimes.map((subs, e) => subs.map((_, s) => matrix?.[e]?.[s] ?? 0))
  return {
    ...info,
    sim_times: simTimes,
    pre_times: simTimes.map((_, e) => info.pre_times?.[e] ?? 0),
    params_to_change: Object.fromEntries(Object.entries(info.params_to_change ?? {}).map(([parameter, matrix]) => [parameter, rows(matrix)])),
    protocol_shapes: {},
    protocol_traces: info.protocol_traces ?? {},
  }
}

/**
 * Splits a parameter's path into its instance and variable, for showing.
 *
 * @param {string} path
 * @returns {{component: string, name: string}}
 */
function splitPath(path) {
  const separator = path.indexOf('/')
  return { component: path.slice(0, separator), name: path.slice(separator + 1) }
}

/**
 * Describes a value that changes over its sub-experiment.
 *
 * @param {Object} cell
 * @returns {string}
 */
function describeCell(cell) {
  const form = cell.form
  if (cell.kind === 'trace') return `Trace ${cell.name}`
  if (!form) return `Pacing ${cell.name}`
  if (form.type === 'ramp') return `Ramp ${form.from} → ${form.to}`
  if (form.type === 'step') return `Step to ${form.level} at ${form.start}`
  if (form.type === 'pulse') return `Pulse of ${form.level}, ${form.start} to ${form.end}`
  return `Pacing ${form.level} every ${form.period}`
}

/** Passes an edited document on. */
const emitDocument = (document) => emit('update:document', document)

/**
 * Applies an edit to the document.
 *
 * @param {Function} change - From protocolEditing.
 * @param {...*} args
 */
const edit = (change, ...args) => emitDocument(change(props.document, ...args))

/** Adds a copy of the selected experiment, and selects it. */
function addExperimentCopy() {
  edit(addExperiment, current.value)
  selected.value = view.value.experiments.length
}

/**
 * Moves the selected experiment one place.
 *
 * @param {number} step - -1 or 1.
 */
function moveSelected(step) {
  edit(moveExperiment, current.value, current.value + step)
  selected.value = current.value + step
}

/**
 * Asks before removing something observations refer to.
 *
 * @param {string[]} observations
 * @param {string} what
 * @returns {Promise<boolean>}
 */
async function confirmRemoving(observations, what) {
  if (!observations.length) return true
  return confirm({
    header: `Remove ${what}?`,
    message: `${observations.length === 1 ? 'An observation refers' : `${observations.length} observations refer`} to it (${observations.join(', ')}), and would be removed with it.`,
    severity: 'warning',
    acceptLabel: 'Remove',
    rejectLabel: 'Keep',
  })
}

/** Removes the selected experiment, once confirmed when observations refer to it. */
async function removeSelected() {
  if (!(await confirmRemoving(findObservationsAt(props.document, current.value), 'this experiment'))) return
  edit(removeExperiment, current.value)
}

/**
 * Removes a sub-experiment of the selected experiment, once confirmed when observations refer to it.
 *
 * @param {number} sub
 */
async function removeSub(sub) {
  if (!(await confirmRemoving(findObservationsAt(props.document, current.value, sub), `sub-experiment ${sub + 1}`))) return
  edit(removeSubExperiment, current.value, sub)
}

/**
 * Has the protocol set a picked parameter, from its value in the model.
 *
 * @param {Object} entry - From the variable index.
 */
function addPicked(entry) {
  const row = props.nodes.find((node) => node.id === entry.nodeId)?.data?.variables?.find((candidate) => candidate.name === entry.rowName)
  const raw = row?.type === 'global_constant' ? props.getGlobalConstant(row.name)?.value : row?.value
  const value = Number.isFinite(Number(raw)) && String(raw ?? '').trim() !== '' ? Number(raw) : 0
  edit(addParameter, entry.path, value)
}
</script>

<style scoped>
.protocol-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.protocol-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  color: var(--p-text-muted-color);
  font-size: 0.875rem;
}

.experiment-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.bar-spacer {
  flex: 1;
}

.experiment-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.field {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8125rem;
}

.table-scroll {
  overflow-x: auto;
}

.protocol-table {
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.protocol-table th,
.protocol-table td {
  padding: 4px 6px;
  text-align: left;
  vertical-align: middle;
}

.protocol-table td {
  min-width: 7rem;
}

.sub-header {
  min-width: 7rem;
  font-weight: 500;
}

.sub-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  white-space: nowrap;
}

.length-label {
  font-weight: normal;
  color: var(--p-text-muted-color);
}

.parameter-path {
  font-weight: normal;
  white-space: nowrap;
}

.parameter-component {
  color: var(--p-text-muted-color);
}

.cell-input {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--p-content-hover-background);
  white-space: nowrap;
}
</style>
