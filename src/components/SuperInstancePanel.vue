<template>
  <div class="super-instance-panel">
    <template v-if="brokenCouplings.length">
      <h5 class="super-instance-panel-title super-instance-panel-title--warn">
        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
        Broken couplings ({{ brokenCouplings.length }})
      </h5>
      <p class="hint">Their ports are no longer exposed. Double-click a connection to re-pair or remove them.</p>
      <ul class="super-instance-panel-list" aria-label="Broken couplings">
        <li v-for="coupling in brokenCouplings" :key="coupling.key" class="broken-coupling">
          {{ coupling.text }}
        </li>
      </ul>
    </template>

    <h5 class="super-instance-panel-title">Overridden values ({{ overrides.length }})</h5>
    <p v-if="!overrides.length" class="hint">
      This super instance has its super-module's values. Open it and edit a value to set one for it alone.
    </p>
    <ul v-else class="super-instance-panel-list" aria-label="Overridden values">
      <li
        v-for="override in overrides"
        :key="`${override.key}:${override.variable}`"
        :class="['override', { 'override--orphaned': override.isOrphaned }]"
      >
        <span class="override-name">{{ override.path }}.{{ override.variable }}</span>
        <span class="override-value">{{ override.value }}</span>
        <i
          v-if="override.isOrphaned"
          class="pi pi-exclamation-triangle override-warning"
          v-tooltip.top="'Its module or variable is gone, so it sets nothing.'"
        ></i>
        <Button
          icon="pi pi-undo"
          text
          rounded
          size="small"
          severity="secondary"
          :aria-label="`Reset ${override.path}.${override.variable}`"
          v-tooltip.left="{ value: 'Back to the super-module’s value', showDelay: 300 }"
          @click="remove(override)"
        />
      </li>
    </ul>
  </div>
</template>

<script setup>
/**
 * A super instance's sidebar: couplings to ports its super-module no longer exposes, kept until the user re-pairs or
 * removes them, and the values it overrides, orphaned ones flagged; each override can be reset.
 */
import { computed } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import Button from 'primevue/button'

import { useModelWriter } from '../composables/useModelWriter'
import { useNodeDataHistory } from '../composables/useNodeDataHistory'
import { FLOW_IDS } from '../utils/constants'

const props = defineProps({
  node: { type: Object, required: true },
})

const { edges, findNode } = useVueFlow(FLOW_IDS.MAIN)
const { overridesOf, removeOverride } = useModelWriter()
const { recordEdit } = useNodeDataHistory(FLOW_IDS.MAIN)

const overrides = computed(() => overridesOf(props.node.id))

// Each coupling of a connection to this super instance whose port it no longer exposes.
const brokenCouplings = computed(() => {
  const broken = new Set(props.node.data?.broken ?? [])
  if (!broken.size) return []
  return edges.value.flatMap((edge) => {
    const side = edge.source === props.node.id ? 'source' : edge.target === props.node.id ? 'target' : null
    if (!side) return []
    const other = findNode(side === 'source' ? edge.target : edge.source)
    return (edge.data?.couplings ?? [])
      .filter((coupling) => broken.has(coupling[`${side}Port`]?.exposedPortId))
      .map((coupling, index) => ({
        key: `${edge.id}:${index}`,
        text: `${coupling[`${side}Port`].label} ↔ ${other?.data?.name ?? '?'}.${coupling[`${side === 'source' ? 'target' : 'source'}Port`]?.label ?? '?'}`,
      }))
  })
})

function remove(override) {
  recordEdit({
    type: 'reset-override',
    nodeIds: [props.node.id],
    keys: ['overrides'],
    apply: () => removeOverride(props.node.id, override.key, override.variable),
  })
}
</script>

<style scoped>
.super-instance-panel-title {
  margin: 0.75rem 0 0.25rem;
  font-size: 13px;
}

.super-instance-panel-title--warn {
  color: var(--p-orange-500);
}

.hint {
  margin: 0 0 0.5rem;
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.super-instance-panel-list {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
}

.broken-coupling {
  padding: 0.15rem 0;
  color: var(--p-orange-500);
}

.override {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.override-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--p-font-family-mono, monospace);
}

.override--orphaned .override-name {
  text-decoration: line-through;
  color: var(--p-text-muted-color);
}

.override-warning {
  color: var(--p-orange-500);
}
</style>
