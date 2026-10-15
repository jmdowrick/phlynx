<template>
  <div class="interface-node" :class="{ selected }">
    <div class="interface-header">
      <i class="pi pi-sign-in interface-icon" aria-hidden="true"></i>
      <span class="interface-title">Interface</span>
    </div>
    <div class="interface-name">{{ supermoduleName }}</div>
    <div class="interface-ports">
      <template v-if="exposedPorts.length">
        {{ exposedPorts.length }} exposed port{{ exposedPorts.length === 1 ? '' : 's' }}
      </template>
      <template v-else>No exposed ports yet</template>
    </div>
  </div>
</template>

<script setup>
/**
 * A super-module's interface node: the record of the super-module, shown inside it. A placeholder card for now, naming
 * the super-module and counting its exposed ports; it can't be deleted from the canvas.
 */
import { computed } from 'vue'

const props = defineProps({
  id: {
    type: String,
    required: true,
  },
  selected: {
    type: Boolean,
    default: false,
  },
  data: {
    type: Object,
    required: true,
  }, // { scope, localId, supermodule: { name, exposedPorts, … } }
})

const supermoduleName = computed(() => props.data.supermodule?.name ?? props.id)
const exposedPorts = computed(() => props.data.supermodule?.exposedPorts ?? [])
</script>

<style scoped>
.interface-node {
  min-width: 160px;
  padding: 0.5rem 0.75rem;
  border: 2px dashed color-mix(in srgb, var(--p-text-color) 30%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--p-primary-color) 6%, var(--p-content-background));
  color: var(--p-text-color);
  text-align: center;
}

.interface-node.selected {
  border-color: var(--p-primary-color);
}

.interface-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: color-mix(in srgb, var(--p-text-color) 70%, transparent);
}

.interface-icon {
  font-size: 0.75rem;
}

.interface-name {
  margin: 0.25rem 0;
  font-weight: 600;
  font-size: 1.05rem;
}

.interface-ports {
  font-size: 0.75rem;
  color: color-mix(in srgb, var(--p-text-color) 70%, transparent);
}
</style>
