<template>
  <section class="simulation-edit" :aria-labelledby="titleId">
    <h5 :id="titleId" class="edit-title">What gets plotted and tried out</h5>
    <!-- The Select draws a span, which a label's `for` can't name. -->
    <label :id="instanceLabelId" class="edit-label">Instance</label>
    <Select
      v-model="editedNodeId"
      :aria-labelledby="instanceLabelId"
      :options="scopeNodes"
      option-label="data.name"
      option-value="id"
      size="small"
      class="edit-select"
    />

    <details v-if="editedNode" class="edit-section" open>
      <summary class="edit-section-title">Variables</summary>
      <div class="edit-picker">
        <InstancePlotVariables v-model="plotEntries" :rows="editedNode.data.variables" :initial-entries="initialEntries" />
      </div>
    </details>

    <SimulationSliders
      v-if="editedNode"
      :key="editedNode.id"
      :node="editedNode"
      :keep-current="keepCurrent"
      @change="emit('change')"
    />
  </section>
</template>

<script setup>
/**
 * Picks a simulated instance and edits what of it gets plotted and tried out: its plotted variables and
 * its parameter sliders. The Simulation tab and the results dialog both show it.
 */
import { computed, ref, useId, watch } from 'vue'

import Select from 'primevue/select'

import InstancePlotVariables from '../InstancePlotVariables.vue'
import SimulationSliders from './SimulationSliders.vue'
import { getNodePlotEntries, setNodePlotVariables } from '../../services/simulation/plotSelections'
import { useSimulationSettingsStore } from '../../stores/simulationSettingsStore'

const editedNodeId = defineModel('editedNodeId', { type: String, default: null })
const props = defineProps({
  scopeNodes: { type: Array, required: true },
  // Makes a change that keeps the shown results true (see useSimulation).
  keepCurrent: { type: Function, required: true },
})
// A slider moved, so the scope wants running again.
const emit = defineEmits(['change'])

const simulationSettingsStore = useSimulationSettingsStore()
const titleId = useId()
const instanceLabelId = useId()

const editedNode = computed(() => props.scopeNodes.find((node) => node.id === editedNodeId.value) ?? null)

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
</script>

<style scoped>
.simulation-edit {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.edit-title {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--p-text-color);
}

.edit-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
}

.edit-select {
  width: 100%;
}

.edit-section-title {
  cursor: pointer;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--p-text-color);
}

.edit-section[open] > .edit-section-title {
  margin-bottom: 8px;
}

.edit-picker {
  height: 300px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
