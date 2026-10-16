<template>
  <div class="exposed-port-list">
    <p class="empty-hint" v-if="!ports.length">
      Nothing exposed yet. Connect a module to the interface, then double-click the connection to pick its ports.
    </p>
    <ol v-else class="exposed-ports">
      <li
        v-for="(port, index) in ports"
        :key="port.id"
        :class="['exposed-port', { 'exposed-port--unresolved': !port.port }]"
        :data-exposed-port="port.id"
      >
        <div class="exposed-port-order">
          <Button
            icon="pi pi-chevron-up"
            text
            rounded
            size="small"
            severity="secondary"
            :aria-label="`Move ${nameOf(port)} up`"
            :disabled="index === 0"
            @click="move(index, -1)"
          />
          <Button
            icon="pi pi-chevron-down"
            text
            rounded
            size="small"
            severity="secondary"
            :aria-label="`Move ${nameOf(port)} down`"
            :disabled="index === ports.length - 1"
            @click="move(index, 1)"
          />
        </div>
        <div class="exposed-port-main">
          <InputText
            :model-value="port.label ?? ''"
            :placeholder="port.port?.label ?? port.ownLabel ?? port.id"
            size="small"
            class="w-full"
            :aria-label="`Label of ${nameOf(port)}`"
            @change="relabel(port, $event.target.value)"
          />
          <span class="exposed-port-source">
            {{ port.childName }}
            <template v-if="port.port"> · {{ port.port.portType }} · {{ variablesOf(port.port) }}</template>
            <template v-else> · no longer resolves</template>
          </span>
        </div>
        <Button
          icon="pi pi-times"
          text
          rounded
          size="small"
          severity="danger"
          :aria-label="`Un-expose ${nameOf(port)}`"
          v-tooltip.left="{ value: 'Un-expose', showDelay: 300 }"
          @click="unexpose(port)"
        />
      </li>
    </ol>
  </div>
</template>

<script setup>
/**
 * A super-module's exposed ports, in order, for its interface node's sidebar: move one to reorder them (their slots
 * and circulatory_autogen's key order), give one its own label, or un-expose it. Each change is one undo step.
 */
import { computed } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'

import { useConfirmDialog } from '../composables/useConfirmDialog'
import { useExposure } from '../composables/useExposure'
import { useHandleManagement } from '../composables/useHandleManagement'

const props = defineProps({
  smId: { type: String, required: true },
})

const { revertHandlesForEdge, reactivateEdgeHandles } = useHandleManagement()
const exposure = useExposure({ handles: { revertHandlesForEdge, reactivateEdgeHandles } })
const { confirm } = useConfirmDialog()
const ports = computed(() => exposure.exposedPortListOf(props.smId))

/** @returns {string} How a port is named in its buttons' labels. */
const nameOf = (port) => port.label ?? port.port?.label ?? port.ownLabel ?? port.id

/** @returns {string} A port's variables, by name. */
const variablesOf = (port) => (port.variables ?? []).map((variable) => variable?.name ?? variable).join(', ')

function move(index, step) {
  const ids = ports.value.map((port) => port.id)
  ;[ids[index], ids[index + step]] = [ids[index + step], ids[index]]
  exposure.reorderExposedPorts(props.smId, ids)
}

function relabel(port, label) {
  exposure.relabelExposedPort(props.smId, port.id, label.trim() || null)
}

function unexpose(port) {
  exposure.unexposePorts(props.smId, [port.id], { confirm })
}
</script>

<style scoped>
.exposed-ports {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.exposed-port {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
}

.exposed-port--unresolved {
  border-color: var(--p-orange-500);
}

.exposed-port-order {
  display: flex;
  flex-direction: column;
}

.exposed-port-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.exposed-port-source {
  font-size: 12px;
  color: var(--p-text-muted-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-hint {
  font-size: 13px;
  color: var(--p-text-muted-color);
}
</style>
