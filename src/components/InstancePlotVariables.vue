<template>
  <div class="plot-tab-body">
    <div class="plot-toolbar">
      <IconField class="w-full">
        <InputIcon class="pi pi-search" />
        <InputText v-model="searchQuery" class="w-full" size="small" placeholder="Search variables..." />
        <InputIcon v-if="searchQuery" class="clear-search-btn pi pi-times-circle" @click="searchQuery = ''" />
      </IconField>
      <span class="plot-summary">
        {{ plottedCount }} of {{ plottableRows.length }} plotted
        <span class="legend-item"><span class="legend-swatch legend-swatch--state"></span>State variable</span>
      </span>
    </div>

    <div v-if="plottableRows.length" class="table-flex-wrapper">
      <DataTable
        :value="visibleRows"
        dataKey="name"
        size="small"
        scrollable
        scrollHeight="flex"
        :rowClass="(row) => ({ 'plot-row--state': row.stateRole === 'state' })"
        class="plot-variables-table"
      >
        <Column style="width: 3rem">
          <template #header>
            <Checkbox
              :modelValue="isAllVisiblePlotted"
              :disabled="!visibleRows.length"
              binary
              aria-label="Plot all shown variables"
              @update:modelValue="setVisiblePlotted"
            />
          </template>
          <template #body="{ data }">
            <Checkbox
              :modelValue="plottedNames.has(data.name)"
              binary
              :aria-label="`Plot ${data.name}`"
              @update:modelValue="(plotted) => setPlotted([data.name], plotted)"
            />
          </template>
        </Column>
        <Column field="name" header="Variable" sortable />
        <Column field="units" header="Units" style="width: 9rem">
          <template #body="{ data }">{{ data.units || '-' }}</template>
        </Column>
      </DataTable>
    </div>
    <div v-else class="empty-state">
      <span>This instance computes no variables to plot.</span>
    </div>

    <p class="plot-hint">Plot groups, and the variables of other instances, are set in Simulation Settings.</p>
  </div>
</template>

<script setup>
/**
 * The instance editor's Plot tab: chooses which of the instance's computed variables are plotted.
 */
import { computed, ref } from 'vue'

import Checkbox from 'primevue/checkbox'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import InputText from 'primevue/inputtext'

import { isPlottableRow } from '../services/simulation/plotSelections'

const props = defineProps({
  rows: { type: Array, default: () => [] },
  modelValue: { type: Array, default: () => [] }, // [{ name, groupId? }]
  initialEntries: { type: Array, default: () => [] }, // The entries when the editor opened
})

const emit = defineEmits(['update:modelValue'])

const searchQuery = ref('')

const plottableRows = computed(() => props.rows.filter(isPlottableRow))
const plottedNames = computed(() => new Set(props.modelValue.map((entry) => entry.name)))
const plottedCount = computed(() => plottableRows.value.filter((row) => plottedNames.value.has(row.name)).length)

const visibleRows = computed(() => {
  const term = searchQuery.value.trim().toLowerCase()
  if (!term) return plottableRows.value
  return plottableRows.value.filter((row) => row.name.toLowerCase().includes(term))
})

const isAllVisiblePlotted = computed(
  () => visibleRows.value.length > 0 && visibleRows.value.every((row) => plottedNames.value.has(row.name))
)

/**
 * Plots or unplots variables. A variable plotted again gets back the group it had when the editor opened;
 * one never plotted has no group yet, so it joins the first one on save.
 *
 * @param {string[]} names
 * @param {boolean} plotted
 */
function setPlotted(names, plotted) {
  const changing = new Set(names)
  const kept = props.modelValue.filter((entry) => !changing.has(entry.name))
  if (!plotted) {
    emit('update:modelValue', kept)
    return
  }
  const existing = props.modelValue.filter((entry) => changing.has(entry.name))
  const existingNames = new Set(existing.map((entry) => entry.name))
  const initialByName = new Map(props.initialEntries.map((entry) => [entry.name, entry]))
  const added = names.filter((name) => !existingNames.has(name)).map((name) => initialByName.get(name) ?? { name })
  emit('update:modelValue', [...kept, ...existing, ...added])
}

/**
 * Plots or unplots every variable the search shows.
 *
 * @param {boolean} plotted
 */
function setVisiblePlotted(plotted) {
  setPlotted(
    visibleRows.value.map((row) => row.name),
    plotted
  )
}
</script>

<style scoped>
.plot-tab-body {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 8px;
}

.plot-toolbar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}

.plot-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--p-text-muted-color);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
}

.legend-swatch--state {
  width: 3px;
  height: 12px;
  background: var(--p-green-500, #22c55e);
}

.clear-search-btn {
  cursor: pointer;
}

.table-flex-wrapper {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* A frame shows the list scrolls rather than running into what follows */
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
}

.plot-variables-table {
  --p-checkbox-width: 1rem;
  --p-checkbox-height: 1rem;
  --p-checkbox-icon-size: 0.625rem;
}

.plot-variables-table :deep(tr.plot-row--state) {
  box-shadow: inset 3px 0 0 0 var(--p-green-500, #22c55e);
}

.empty-state {
  display: flex;
  justify-content: center;
  color: var(--p-text-muted-color);
  font-size: var(--dlg-fs-small);
  margin-top: 16px;
}

.plot-hint {
  flex-shrink: 0;
  margin: 0;
  font-size: 11px;
  color: var(--p-text-muted-color);
}
</style>
