<template>
  <div class="interface-node" :class="{ selected }">
    <div class="interface-header">
      <i class="pi pi-sign-in interface-icon" aria-hidden="true"></i>
      <span class="interface-title">Interface</span>
    </div>
    <div class="interface-name">{{ supermoduleName }}</div>
    <ol v-if="ports.length" class="interface-port-list" :aria-label="`Ports of ${supermoduleName}`">
      <li v-for="port in ports" :key="port.exposedPortId">
        <span class="interface-port-label"
          ><span v-if="owners.has(port.exposedPortId)" class="interface-port-owner">{{ owners.get(port.exposedPortId) }} · </span
          >{{ port.label }}</span
        >
        <span class="interface-port-type">{{ port.portType }}</span>
      </li>
    </ol>
    <div v-else class="interface-ports">No exposed ports yet</div>

    <NodeHandles :id="id" :handles="data.handles" :selected="selected" />
  </div>
</template>

<script setup>
/**
 * A super-module's interface node: the record of the super-module, shown inside it. Names the super-module and lists,
 * in order, the ports its exposure edges expose, as its super instances get them, each with the child it is on. Its
 * handles are only where exposure edges attach, as on any node; it can't be deleted from the canvas.
 */
import { computed } from 'vue'

import NodeHandles from './NodeHandles.vue'
import { useExposedPortOwners } from '../composables/useExposure'
import { useSupermodules } from '../composables/useSupermodules'

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
  }, // { scope, localId, supermodule: { name, … }, handles }
})

const { portsOf } = useSupermodules()
const ownersOf = useExposedPortOwners()

const supermoduleName = computed(() => props.data.supermodule?.name ?? props.id)
const ports = computed(() => portsOf(props.id))
// Each exposed port's child, so two of the same name read apart.
const owners = computed(() => ownersOf(props.id))
</script>

<style lang="scss" scoped>
@import '../assets/vueflowhandle.css';

.interface-node {
  min-width: 200px;
  min-height: 90px;
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

.interface-port-list {
  margin: 0.25rem 0 0;
  padding: 0;
  list-style: none;
  font-size: 0.75rem;
  text-align: left;
}

.interface-port-list li {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
}

.interface-port-owner,
.interface-port-type {
  color: color-mix(in srgb, var(--p-text-color) 60%, transparent);
}

.interface-ports {
  font-size: 0.75rem;
  color: color-mix(in srgb, var(--p-text-color) 70%, transparent);
}
</style>
