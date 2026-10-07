<template>
  <section class="protocol-editor">
    <div v-if="!protocolInfo" class="protocol-empty">
      <i class="pi pi-sliders-h empty-icon" aria-hidden="true"></i>
      <h3>Run the model as experiments</h3>
      <p>
        A protocol is a set of experiments. Each runs the model through sub-experiments in turn, setting parameters to
        numbers, steps, pulses, pacing, ramps or recorded traces, as CUFLynx and circulatory autogen do.
      </p>
      <Button label="Create a protocol" icon="pi pi-plus" @click="emitDocument(ensureProtocol(document))" />
    </div>

    <div v-else class="protocol-layout">
      <nav class="experiment-rail" aria-label="Experiments">
        <h4 class="rail-heading">Experiments</h4>
        <ul class="rail-list">
          <li v-for="(item, index) in view.experiments" :key="index" class="rail-entry" :class="{ 'rail-entry--active': index === current }">
            <button type="button" class="rail-item" :aria-label="nameOf(item, index)" :aria-pressed="index === current" @click="selected = index">
              <span class="swatch" :style="{ background: colourOf(item, index) }" aria-hidden="true"></span>
              <span class="rail-text">
                <span class="rail-name">{{ nameOf(item, index) }}</span>
                <span class="rail-meta">{{ formatNumber(item.duration) }} s in {{ countLabel(item.subs.length) }}</span>
              </span>
            </button>
            <Button
              icon="pi pi-ellipsis-h"
              text
              rounded
              size="small"
              severity="secondary"
              class="rail-more"
              :aria-label="`More for ${nameOf(item, index)}`"
              @click="(event) => openExperimentMenu(event, index)"
            />
          </li>
        </ul>
        <Button label="Add experiment" icon="pi pi-plus" text size="small" class="rail-add" aria-label="Add an experiment, a copy of this one" v-tooltip.bottom="'A copy of the experiment shown'" @click="addExperimentCopy" />
        <Menu ref="experimentMenu" :model="experimentMenuItems" popup />
      </nav>

      <div class="experiment-main">
        <InputText
          :key="`name-${current}`"
          :model-value="experiment.label ?? ''"
          :placeholder="`Experiment ${current + 1}`"
          class="experiment-name"
          aria-label="Experiment name"
          @change="(event) => edit(setTiming, { experiment: current, label: event.target.value })"
        />

        <div class="timeline-scroll">
          <div class="timeline" :style="{ gridTemplateColumns: columns }">
            <div class="timeline-corner">Sub-experiments</div>
            <div class="column-head warm-up-head" :class="{ 'warm-up-head--none': !(experiment.preTime > 0) }">
              <span class="column-title" v-tooltip.bottom="'Run first, unplotted, to let the model settle'">Warm-up</span>
              <InputNumber
                :model-value="experiment.preTime"
                :min="0"
                :max-fraction-digits="8"
                suffix=" s"
                size="small"
                fluid
                aria-label="Warm-up"
                @update:model-value="(value) => value != null && edit(setTiming, { experiment: current, preTime: value })"
              />
            </div>
            <div v-for="(sub, s) in experiment.subs" :key="`head-${s}`" class="column-head">
              <span class="column-title">
                {{ s + 1 }}
                <Button
                  v-if="experiment.subs.length > 1"
                  icon="pi pi-times"
                  text
                  rounded
                  size="small"
                  severity="secondary"
                  class="column-remove"
                  :aria-label="`Remove sub-experiment ${s + 1}`"
                  @click="removeSub(s)"
                />
              </span>
              <InputNumber
                :model-value="sub.duration"
                :min="0"
                :max-fraction-digits="8"
                suffix=" s"
                size="small"
                fluid
                :aria-label="`Sub-experiment ${s + 1} length`"
                @update:model-value="(value) => value != null && edit(setTiming, { experiment: current, sub: s, duration: value })"
              />
            </div>
            <div class="column-add">
              <Button icon="pi pi-plus" text rounded size="small" aria-label="Add a sub-experiment" v-tooltip.bottom="'Add a sub-experiment'" @click="edit(addSubExperiment, current)" />
            </div>

            <template v-for="lane in lanes" :key="lane.parameter">
              <div class="lane-label" :title="lane.parameter">
                <span class="lane-path"><span class="lane-component">{{ lane.component }}/</span>{{ lane.name }}</span>
                <span class="lane-units">{{ lane.units }}</span>
                <Button
                  icon="pi pi-trash"
                  text
                  rounded
                  size="small"
                  severity="secondary"
                  class="lane-remove"
                  :aria-label="`Stop setting ${lane.parameter}`"
                  @click="edit(removeParameter, lane.parameter)"
                />
              </div>
              <div class="lane-cell lane-cell--warm-up" aria-hidden="true">
                <svg v-if="lane.warmUp" viewBox="0 0 100 40" preserveAspectRatio="none">
                  <polyline :points="lane.warmUp" :stroke="colour" />
                </svg>
              </div>
              <button
                v-for="cell in lane.cells"
                :key="cell.sub"
                type="button"
                class="lane-cell"
                :class="{ 'lane-cell--early': cell.isEarly, 'lane-cell--open': isEditing(lane.parameter, cell.sub) }"
                :aria-label="`Change how ${lane.parameter} varies in sub-experiment ${cell.sub + 1}`"
                @click="(event) => openCell(event, lane.parameter, cell.cell, cell.sub)"
              >
                <svg v-if="cell.points" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
                  <polyline :points="cell.points" :stroke="colour" />
                </svg>
                <span class="cell-caption" :title="cell.isEarly ? 'Starts with the warm-up, as circulatory autogen runs it' : cell.description">
                  <i v-if="cell.isEarly" class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                  {{ cell.caption }}
                </span>
              </button>
              <div></div>
            </template>
          </div>
        </div>

        <div class="add-parameter">
          <VariablePathPicker
            :index="index"
            :filter="(entry) => entry.slidable && !setParameters.has(entry.path)"
            placeholder="Add a parameter to set…"
            aria-label="Add a parameter for the protocol to set"
            @pick="addPicked"
          />
        </div>
        <p v-if="!lanes.length" class="lanes-empty">Add a parameter for the experiments to set, such as a stimulus current or a conductance.</p>

        <div v-if="validation.errors.length || validation.warnings.length" class="messages">
          <Message v-for="message in validation.errors" :key="message" severity="error" size="small">{{ message }}</Message>
          <Message v-for="message in validation.warnings" :key="message" severity="warn" size="small">{{ message }}</Message>
        </div>
      </div>
    </div>

    <Popover ref="cellPopover" @hide="editing = null">
      <ProtocolCellEditor
        v-if="editing"
        :key="editing.key"
        :parameter="editing.parameter"
        :sub="editing.sub"
        :cell="editing.cell"
        :duration="editing.duration"
        :traces="protocolInfo?.protocol_traces ?? {}"
        :units="editing.units"
        :colour="colour"
        :pre-time="experiment?.preTime ?? 0"
        :can-align="!!editing && isEarly(editing.cell, editing.sub)"
        @apply="applyCell"
        @align="alignCell"
        @cancel="cellPopover.hide()"
      />
    </Popover>
  </section>
</template>

<script setup>
/**
 * Edits a protocol as circulatory autogen and CUFLynx write it, in an obs_data document. Its experiments are listed
 * beside a timeline of the one shown: a column for the warm-up and for each sub-experiment, as wide as it is long,
 * and a lane for each parameter drawing how it varies. A segment opens the editor of how it varies there.
 */
import { computed, ref } from 'vue'

import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import Menu from 'primevue/menu'
import Message from 'primevue/message'
import Popover from 'primevue/popover'

import ProtocolCellEditor from './ProtocolCellEditor.vue'
import VariablePathPicker from './VariablePathPicker.vue'
import { useConfirmDialog } from '../../composables/useConfirmDialog'
import { readObsDataParts } from '../../services/protocol/obsDataDocument'
import { findCircAutogenLimits } from '../../services/protocol/protocolCompatibility'
import {
  addExperiment,
  addParameter,
  addSubExperiment,
  alignWithWarmUp,
  ensureProtocol,
  findObservationsAt,
  moveExperiment,
  removeExperiment,
  removeParameter,
  removeSubExperiment,
  setInput,
  setTiming,
  setValue,
} from '../../services/protocol/protocolEditing'
import { changesDuringWarmUp, readProtocolInfo } from '../../services/protocol/protocolModel'
import { findValueRange, sampleInput, writePolylinePoints } from '../../services/protocol/protocolPreview'
import { validateProtocolInfo } from '../../services/protocol/protocolValidation'
import { SERIES_COLOURS } from '../../services/simulation/seriesSlots'
import { buildVariableIndex } from '../../services/simulation/variableIndex'

// Matplotlib's colour letters, as CA's experiment_colors use them.
const MATPLOTLIB_COLOURS = { r: '#e34948', b: '#2a78d6', g: '#1baf7a', m: '#e87ba4', c: '#17becf', y: '#eda100', k: '#52514e' }
const BOX = { width: 100, height: 40, inset: 2 }

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
const unitsByPath = computed(() => new Map(index.value.map((entry) => [entry.path, entry.units])))
const protocolInfo = computed(() => (props.document ? readObsDataParts(props.document).protocolInfo : null))
const validation = computed(() => {
  if (!protocolInfo.value) return { errors: [], warnings: [] }
  const checked = validateProtocolInfo(protocolInfo.value)
  // What CUFLynx couldn't run, though PhLynx can.
  return checked.protocolInfo ? { ...checked, warnings: [...checked.warnings, ...findCircAutogenLimits(readProtocolInfo(checked.protocolInfo))] } : checked
})
// Shown as written while it has errors CA would refuse, so it stays editable.
const view = computed(() => readProtocolInfo(validation.value.protocolInfo ?? withDefaults(protocolInfo.value)))
// The experiment shown, kept within the experiments while an edit adding or removing one comes back.
const current = computed(() => Math.min(selected.value, view.value.experiments.length - 1))
const experiment = computed(() => view.value.experiments[current.value])
const colour = computed(() => colourOf(experiment.value, current.value))
const setParameters = computed(() => new Set(view.value.controls.map(({ parameter }) => parameter)))

// The label, the warm-up, then each sub-experiment as wide as it is long, then the column to add one.
const columns = computed(() => {
  // Shares of the space left, made to sum to 10: factors summing to less than 1 would leave some of it unused.
  const total = experiment.value.duration || 1
  const subs = experiment.value.subs.map(({ duration }) => `minmax(5.5rem, ${((10 * Math.max(duration, 0)) / total).toFixed(4)}fr)`)
  return ['minmax(10rem, 13rem)', experiment.value.preTime > 0 ? '6.5rem' : '5rem', ...subs, '2.5rem'].join(' ')
})

// Each parameter's lane: its input in the warm-up and in each sub-experiment, on one scale.
const lanes = computed(() =>
  view.value.controls.map(({ parameter, cells }) => {
    const { preTime, subs } = experiment.value
    const row = cells[current.value]
    // CA starts a first sub-experiment's input with the warm-up, so the warm-up shows its start.
    const windows = subs.map(({ duration }, s) => (s === 0 ? [preTime, preTime + duration] : [0, duration]))
    const samples = row.map((cell, s) => sampleInput(cell, ...windows[s]))
    const warmUp = preTime > 0 ? sampleInput(row[0], 0, preTime) : null
    const { low, high } = findValueRange([warmUp, ...samples])
    const draw = (sample, [from, to]) => sample && writePolylinePoints(sample, { from, to, low, high, ...BOX })
    const separator = parameter.indexOf('/')
    return {
      parameter,
      component: parameter.slice(0, separator),
      name: parameter.slice(separator + 1),
      units: unitsByPath.value.get(parameter) ?? '',
      warmUp: warmUp && draw(warmUp, [0, preTime]),
      cells: row.map((cell, s) => ({
        sub: s,
        cell,
        points: draw(samples[s], windows[s]),
        caption: captionOf(cell),
        description: describeCell(cell),
        isEarly: isEarly(cell, s),
      })),
    }
  })
)

/**
 * Fills in what readProtocolInfo needs of a protocol CA would refuse, so it can still be shown.
 *
 * @param {Object} info
 * @returns {Object}
 */
function withDefaults(info) {
  const simTimes = Array.isArray(info.sim_times) ? info.sim_times.map((subs) => (Array.isArray(subs) && subs.length ? subs : [1])) : [[1]]
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
 * Formats a number shortly, for captions.
 *
 * @param {number} value
 * @returns {string}
 */
const formatNumber = (value) => (Number.isFinite(value) ? String(Number(value.toPrecision(4))) : '–')

/**
 * Counts an experiment's sub-experiments, shortly.
 *
 * @param {number} count
 * @returns {string}
 */
const countLabel = (count) => `${count} ${count === 1 ? 'part' : 'parts'}`

/**
 * Names an experiment, as its label or its place.
 *
 * @param {{label: string|null}} item
 * @param {number} position
 * @returns {string}
 */
const nameOf = (item, position) => item.label ?? `Experiment ${position + 1}`

/**
 * Colours an experiment as its file does, or by its place.
 *
 * @param {{colour: string|null}} item
 * @param {number} position
 * @returns {string}
 */
function colourOf(item, position) {
  const given = item?.colour
  if (given && MATPLOTLIB_COLOURS[given]) return MATPLOTLIB_COLOURS[given]
  if (given && /^#[0-9a-f]{3,8}$/i.test(given)) return given
  return SERIES_COLOURS.light[position % SERIES_COLOURS.light.length]
}

/**
 * Captions a segment: its number, or the kind of input.
 *
 * @param {Object} cell
 * @returns {string}
 */
function captionOf(cell) {
  if (cell.kind === 'constant') return formatNumber(cell.value)
  if (cell.kind === 'trace') return 'Trace'
  return { step: 'Step', pulse: 'Pulse', pacing: 'Pacing', ramp: 'Ramp' }[cell.form?.type] ?? 'Pacing'
}

/**
 * Describes an input in full, for its tooltip.
 *
 * @param {Object} cell
 * @returns {string}
 */
function describeCell(cell) {
  const form = cell.form
  if (cell.kind === 'constant') return String(cell.value)
  if (cell.kind === 'trace') return cell.trace ? `A trace of ${cell.trace.t.length} points` : `The trace ${cell.name}, which the file lacks`
  if (!form) return `Pacing of several events (${cell.name})`
  if (form.type === 'ramp') return `A ramp from ${form.from} to ${form.to}`
  if (form.type === 'step') return `A step from ${form.baseline} to ${form.level} at ${form.start} s`
  if (form.type === 'pulse') return `A pulse of ${form.level} from ${form.start} s to ${form.end} s, else ${form.baseline}`
  return `Pacing at ${form.level} for ${form.length} s every ${form.period} s, else ${form.baseline}`
}

/**
 * Whether an input starts with the warm-up, as CA runs a first sub-experiment's, so it runs earlier than written.
 *
 * @param {Object} cell
 * @param {number} sub
 * @returns {boolean}
 */
function isEarly(cell, sub) {
  if (sub !== 0 || !(experiment.value.preTime > 0)) return false
  try {
    return changesDuringWarmUp(cell, experiment.value.preTime, experiment.value.subs[0].duration)
  } catch {
    return false
  }
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

/** Adds a copy of the experiment shown, and shows it. */
function addExperimentCopy() {
  edit(addExperiment, current.value)
  selected.value = view.value.experiments.length
}

const experimentMenu = ref(null)
const menuExperiment = ref(0)
const experimentMenuItems = computed(() => [
  { label: 'Duplicate', icon: 'pi pi-copy', command: () => ((selected.value = menuExperiment.value), addExperimentCopy()) },
  { label: 'Move up', icon: 'pi pi-arrow-up', disabled: menuExperiment.value === 0, command: () => moveExperimentBy(menuExperiment.value, -1) },
  {
    label: 'Move down',
    icon: 'pi pi-arrow-down',
    disabled: menuExperiment.value === view.value.experiments.length - 1,
    command: () => moveExperimentBy(menuExperiment.value, 1),
  },
  { separator: true },
  { label: 'Delete', icon: 'pi pi-trash', disabled: view.value.experiments.length < 2, command: () => removeExperimentAt(menuExperiment.value) },
])

/**
 * Opens an experiment's menu.
 *
 * @param {MouseEvent} event
 * @param {number} position
 */
function openExperimentMenu(event, position) {
  menuExperiment.value = position
  experimentMenu.value.toggle(event)
}

/**
 * Moves an experiment one place, still showing it.
 *
 * @param {number} position
 * @param {number} step - -1 or 1.
 */
function moveExperimentBy(position, step) {
  edit(moveExperiment, position, position + step)
  selected.value = position + step
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

/**
 * Removes an experiment, once confirmed when observations refer to it.
 *
 * @param {number} position
 */
async function removeExperimentAt(position) {
  if (!(await confirmRemoving(findObservationsAt(props.document, position), nameOf(view.value.experiments[position], position)))) return
  edit(removeExperiment, position)
}

/**
 * Removes a sub-experiment of the experiment shown, once confirmed when observations refer to it.
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

const cellPopover = ref(null)
// The segment being edited: `{ key, parameter, cell, sub, duration, units }`.
const editing = ref(null)
let editCount = 0

/**
 * Whether a segment's editor is open.
 *
 * @param {string} parameter
 * @param {number} sub
 * @returns {boolean}
 */
const isEditing = (parameter, sub) => editing.value?.parameter === parameter && editing.value?.sub === sub

/**
 * Opens the editor of how a parameter varies in a sub-experiment, below its segment.
 *
 * @param {MouseEvent} event
 * @param {string} parameter
 * @param {Object} cell
 * @param {number} sub
 */
function openCell(event, parameter, cell, sub) {
  const anchor = event.currentTarget
  const units = unitsByPath.value.get(parameter) ?? ''
  editing.value = { key: ++editCount, parameter, cell, sub, duration: experiment.value.subs[sub].duration, units }
  // Once the click is over, or it closes the popover again.
  setTimeout(() => cellPopover.value?.show({ currentTarget: anchor }, anchor), 0)
}

/**
 * Applies the segment editor's change: a number, a shape, a trace, or a trace the file has.
 *
 * @param {{value?: number, shape?: Object, trace?: Object, traceName?: string}} change
 */
function applyCell({ value, shape, trace, traceName }) {
  const { parameter, sub } = editing.value
  const where = { parameter, experiment: current.value, sub }
  if (shape || trace) edit(setInput, { ...where, shape, trace })
  else edit(setValue, { ...where, value: traceName ?? value })
  cellPopover.value.hide()
}

/** Starts the edited input with its sub-experiment rather than with the warm-up. */
function alignCell() {
  const { parameter, cell } = editing.value
  edit(alignWithWarmUp, { parameter, experiment: current.value, ...(cell.kind === 'shape' ? { shape: cell.shape } : { trace: cell.trace }) })
  cellPopover.value.hide()
}
</script>

<style scoped>
.protocol-editor {
  --lane-height: 3.25rem;
  --hatch: color-mix(in srgb, var(--p-text-muted-color) 14%, transparent);
}

.protocol-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 34rem;
  margin: 24px auto;
  text-align: center;
  color: var(--p-text-muted-color);
}

.protocol-empty h3 {
  margin: 0;
  color: var(--p-text-color);
}

.protocol-empty p {
  margin: 0 0 6px;
  line-height: 1.5;
}

.empty-icon {
  font-size: 1.75rem;
  color: var(--p-primary-color);
}

.protocol-layout {
  display: grid;
  grid-template-columns: 13rem minmax(0, 1fr);
  gap: 18px;
  min-height: 22rem;
}

.experiment-rail {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 14px;
  border-right: 1px solid var(--p-content-border-color);
}

.rail-heading {
  margin: 0 0 4px;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--p-text-muted-color);
}

.rail-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.rail-entry {
  display: flex;
  align-items: center;
  border-radius: 8px;
}

.rail-entry:hover {
  background: var(--p-content-hover-background);
}

.rail-entry--active {
  background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
}

.rail-item {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 6px 8px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.swatch {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.rail-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.rail-name {
  overflow: hidden;
  font-size: 0.875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rail-meta {
  overflow: hidden;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rail-more {
  opacity: 0;
}

.rail-entry:hover .rail-more,
.rail-entry--active .rail-more,
.rail-more:focus-visible {
  opacity: 1;
}

.rail-add {
  align-self: flex-start;
}

.experiment-main {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.experiment-name {
  align-self: flex-start;
  min-width: 16rem;
  font-size: 1.05rem;
  font-weight: 600;
}

.timeline-scroll {
  overflow-x: auto;
}

.timeline {
  display: grid;
  width: 100%;
  column-gap: 2px;
  row-gap: 4px;
  font-size: 0.8125rem;
}

.timeline-corner {
  align-self: end;
  padding-bottom: 8px;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.column-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 6px 8px;
  border-radius: 8px 8px 0 0;
  background: var(--p-content-hover-background);
}

.warm-up-head {
  background: repeating-linear-gradient(135deg, var(--hatch) 0 6px, transparent 6px 12px);
}

.warm-up-head--none {
  opacity: 0.7;
}

.column-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 1.6rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
}

.column-remove {
  opacity: 0;
}

.column-head:hover .column-remove,
.column-remove:focus-visible {
  opacity: 1;
}

.column-add {
  display: flex;
  align-items: center;
  justify-content: center;
}

.lane-label {
  display: flex;
  flex-direction: column;
  justify-content: center;
  position: relative;
  min-width: 0;
  padding-right: 28px;
}

.lane-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lane-component {
  color: var(--p-text-muted-color);
}

.lane-units {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.lane-remove {
  position: absolute;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
  opacity: 0;
}

.lane-label:hover .lane-remove,
.lane-remove:focus-visible {
  opacity: 1;
}

.lane-cell {
  position: relative;
  height: var(--lane-height);
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: color-mix(in srgb, var(--p-content-hover-background) 60%, transparent);
  font: inherit;
  color: inherit;
  cursor: pointer;
  overflow: hidden;
}

.lane-cell:hover,
.lane-cell--open {
  border-color: color-mix(in srgb, var(--p-primary-color) 60%, transparent);
}

.lane-cell:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 1px;
}

.lane-cell--warm-up {
  cursor: default;
  background: repeating-linear-gradient(135deg, var(--hatch) 0 6px, transparent 6px 12px);
}

.lane-cell--early {
  border-color: var(--p-orange-400);
  border-style: dashed;
}

.lane-cell svg {
  position: absolute;
  top: 20px;
  right: 2px;
  bottom: 6px;
  left: 2px;
  width: calc(100% - 4px);
  height: calc(100% - 26px);
}

/* The warm-up has no caption, so its line has the whole height. */
.lane-cell--warm-up svg {
  top: 20px;
}

.lane-cell polyline {
  fill: none;
  stroke-width: 2;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.cell-caption {
  position: absolute;
  top: 3px;
  left: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 4px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--p-content-background) 85%, transparent);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.cell-caption .pi {
  font-size: 0.7rem;
  color: var(--p-orange-500);
}

.add-parameter {
  max-width: 28rem;
}

.lanes-empty {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--p-text-muted-color);
}

.messages {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
