<template>
  <section class="slider-definitions" aria-label="Slider ranges">
    <VariablePathPicker
      :index="index"
      :filter="(entry) => entry.slidable && !definedKeys.has(definitionKeyFor(entry))"
      placeholder="Add a slider…"
      aria-label="Add a slider"
      @pick="addDefinition"
    />

    <table v-if="rows.length" class="definitions-table">
      <thead>
        <tr>
          <th scope="col">Parameter</th>
          <th scope="col">Min</th>
          <th scope="col">Default</th>
          <th scope="col">Max</th>
          <th scope="col"><span class="visually-hidden">Remove</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.key" :class="{ 'definition--missing': !row.isSlidable }">
          <th scope="row" class="definition-path" :title="row.isSlidable ? `${row.componentLabel}/${row.parameterName}` : 'No longer a parameter'">
            <span class="definition-component">{{ row.componentLabel }}/</span><span class="definition-name">{{ row.parameterName }}</span>
            <span class="definition-units">{{ row.units }}</span>
          </th>
          <td v-for="field in FIELDS" :key="field">
            <InputNumber
              :model-value="row[field]"
              :pt:pcInputText:root="{ 'data-testid': `param-${field}-${row.parameterName}` }"
              :aria-label="`${row.parameterName} ${field}`"
              :min-fraction-digits="0"
              :max-fraction-digits="8"
              size="small"
              fluid
              @update:model-value="(value) => updateDefinition(row, { [field]: value })"
            />
          </td>
          <td>
            <Button
              icon="pi pi-times"
              text
              rounded
              size="small"
              severity="secondary"
              :aria-label="`Remove the ${row.parameterName} slider`"
              @click="emit('update:scanConfig', removeSlider(scanConfig, row.key))"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="definitions-empty">No sliders yet. Search above for a parameter to give a slider.</p>
  </section>
</template>

<script setup>
/**
 * The ranges of the parameter sliders, as exported for web OpenCOR: each slider's minimum, default and
 * maximum, with the same search across the whole model the Simulation tab uses to add one.
 */
import { computed } from 'vue'

import Button from 'primevue/button'
import InputNumber from 'primevue/inputnumber'

import VariablePathPicker from './VariablePathPicker.vue'
import { createSliderDefinition, isSlidableRow, putSlider, removeSlider } from '../../services/simulation/parameterSliders'
import { GLOBAL_COMPONENT, buildVariableIndex } from '../../services/simulation/variableIndex'

// A slider moves smoothly across its range, so no step is asked for.
const FIELDS = ['min', 'default', 'max']

const props = defineProps({
  scanConfig: { type: Object, default: () => ({ selections: [] }) },
  nodes: { type: Array, default: () => [] },
  getGlobalConstant: { type: Function, required: true },
})
const emit = defineEmits(['update:scanConfig'])

const index = computed(() => buildVariableIndex(props.nodes))
const nodesById = computed(() => new Map(props.nodes.map((node) => [node.id, node])))
const definitions = computed(() => props.scanConfig?.selections ?? [])
const definedKeys = computed(() => new Set(definitions.value.map((definition) => definition.key)))

const rows = computed(() =>
  definitions.value.map((definition) => {
    const node = nodesById.value.get(definition.nodeId)
    const row = node?.data?.variables?.find((candidate) => candidate.name === definition.parameterName)
    return {
      ...definition,
      isSlidable: isSlidableRow(row),
      componentLabel: definition.type === 'global_constant' ? GLOBAL_COMPONENT : node?.data?.name ?? definition.nodeName,
    }
  })
)

/**
 * Gets the definition key an index entry would have: its node and row.
 *
 * @param {Object} entry
 * @returns {string}
 */
const definitionKeyFor = (entry) => `${entry.nodeId}::${entry.rowName}`

/**
 * Adds a slider for a picked parameter, its range around the parameter's value.
 *
 * @param {Object} entry
 */
function addDefinition(entry) {
  const node = nodesById.value.get(entry.nodeId)
  const row = node?.data?.variables?.find((candidate) => candidate.name === entry.rowName)
  if (!node || !row) return
  emit('update:scanConfig', putSlider(props.scanConfig, createSliderDefinition(node, row, props.getGlobalConstant)))
}

/**
 * Changes a slider's range, keeping its place in the list.
 *
 * @param {Object} row
 * @param {Object} change
 */
function updateDefinition(row, change) {
  const selections = definitions.value.map((definition) => (definition.key === row.key ? { ...definition, ...change } : definition))
  emit('update:scanConfig', { ...props.scanConfig, selections })
}
</script>

<style scoped>
.slider-definitions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.definitions-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.definitions-table th,
.definitions-table td {
  padding: 4px 6px;
  border-bottom: 1px solid var(--p-content-border-color);
  text-align: left;
  vertical-align: middle;
}

.definitions-table thead th {
  font-weight: 600;
  color: var(--p-text-muted-color);
}

.definitions-table td {
  width: 7rem;
}

.definition-path {
  font-weight: 400;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 16rem;
}

.definition-component {
  color: var(--p-text-muted-color);
}

.definition-name {
  font-weight: 600;
}

.definition-units {
  margin-left: 6px;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.definition--missing .definition-path {
  color: var(--p-orange-600);
}

.definitions-empty {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--p-text-muted-color);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
</style>
