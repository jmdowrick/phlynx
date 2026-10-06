<template>
  <div class="simulation-toolbar" role="toolbar" aria-label="Simulation">
    <Button
      v-if="isRunning"
      icon="pi pi-stop"
      rounded
      severity="danger"
      size="small"
      aria-label="Stop the simulation"
      v-tooltip.bottom="'Stop'"
      @click="emit('stop')"
    />
    <Button
      v-else
      :icon="isLoading ? 'pi pi-spin pi-spinner' : 'pi pi-play'"
      rounded
      size="small"
      :disabled="!canPlay"
      :aria-label="playLabel"
      v-tooltip.bottom="playHint"
      class="toolbar-play"
      :class="{ 'toolbar-play--outdated': isOutdated }"
      @click="emit('play')"
    />

    <label class="toolbar-scope" v-tooltip.bottom="scopeLabel">
      <ToggleSwitch v-model="isWholeModel" :aria-label="`Simulate the whole model, not the selection`" />
      <span class="toolbar-scope-label">{{ scopeLabel }}</span>
    </label>

    <span class="toolbar-spacer"></span>
    <Button
      icon="pi pi-window-maximize"
      text
      rounded
      size="small"
      severity="secondary"
      :disabled="!canExpand"
      aria-label="Open the results in a larger view"
      v-tooltip.bottom="'Expand'"
      @click="emit('expand')"
    />
    <Button
      icon="pi pi-cog"
      text
      rounded
      size="small"
      severity="secondary"
      :disabled="isRunning"
      aria-label="Simulation settings"
      v-tooltip.bottom="'Simulation settings'"
      @click="openSimSettings('parameters')"
    />
  </div>
</template>

<script setup>
/**
 * The Simulation tab's controls: play or stop, whether play runs the selection or the whole model, and
 * buttons for the larger view and the simulation settings.
 */
import { computed } from 'vue'

import Button from 'primevue/button'
import ToggleSwitch from 'primevue/toggleswitch'

import { useSimSettingsDialog } from '../../composables/useSimSettingsDialog'

const scopeMode = defineModel('scopeMode', { type: String, default: 'model' })
const props = defineProps({
  isRunning: { type: Boolean, default: false },
  // The simulator is still loading.
  isLoading: { type: Boolean, default: false },
  // Why play can't run, if it can't.
  blockedReason: { type: String, default: null },
  selectedCount: { type: Number, default: 0 },
  // The shown results are out of date, so play would update them.
  isOutdated: { type: Boolean, default: false },
  canExpand: { type: Boolean, default: false },
})
const emit = defineEmits(['play', 'stop', 'expand'])

const { open: openSimSettings } = useSimSettingsDialog()

const isWholeModel = computed({
  get: () => scopeMode.value === 'model',
  set: (value) => (scopeMode.value = value ? 'model' : 'selection'),
})
const scopeLabel = computed(() => (isWholeModel.value ? 'Whole model' : `Selection (${props.selectedCount})`))
const canPlay = computed(() => !props.blockedReason && !props.isLoading)
const playLabel = computed(() => (isWholeModel.value ? 'Simulate the whole model' : `Simulate the selection (${props.selectedCount})`))
const playHint = computed(() => props.blockedReason ?? (props.isLoading ? 'Loading the simulator…' : `${playLabel.value} (F9)`))
</script>

<style scoped>
.simulation-toolbar {
  container-type: inline-size;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.toolbar-scope {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 0.8125rem;
  color: var(--p-text-color);
  cursor: pointer;
}

.toolbar-scope :deep(.p-toggleswitch) {
  flex-shrink: 0;
}

.toolbar-scope-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Too narrow for the label: the switch alone, its scope in the tooltip. */
@container (max-width: 220px) {
  .toolbar-scope-label {
    display: none;
  }
}

.toolbar-spacer {
  flex: 1;
}

/* Out-of-date results: a dot on play says it would update them. */
.toolbar-play {
  position: relative;
  flex-shrink: 0;
}

.toolbar-play--outdated::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--p-orange-500);
  box-shadow: 0 0 0 2px var(--p-content-background);
}
</style>
