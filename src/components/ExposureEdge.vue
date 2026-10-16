<template>
  <!-- On the edge's group, its first child: hovering anywhere on it lists what it exposes. An SVG title, as PrimeVue's
    tooltip can't place itself on SVG. -->
  <title v-if="entries.length">{{ entries.join('\n') }}</title>
  <BaseEdge :id="id" :path="path[0]" :style="style" class="exposure-edge" />
  <!-- Marks an edge that exposes nothing yet; double-click the edge to pick its ports -->
  <EdgeLabelRenderer v-if="!entries.length">
    <div
      class="exposure-edge-label nodrag nopan"
      :style="{ transform: `translate(-50%, -50%) translate(${path[1]}px, ${path[2]}px)` }"
    >
      Nothing exposed
    </div>
  </EdgeLabelRenderer>
</template>

<script setup>
/**
 * An exposure edge, from a child of a super-module to its interface: dashed, and unlabelled but for "Nothing exposed"
 * while it exposes nothing. Hovering it lists what it exposes, in order, as "child · port". It carries no couplings.
 */
import { computed } from 'vue'
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useVueFlow } from '@vue-flow/core'

import { ownedLabel } from '../composables/useExposure'
import { exposureEnds } from '../services/hierarchy/exposure'
import { EXPOSURE_EDGE_TYPE } from '../utils/constants'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  id: { type: String, required: true },
  source: { type: String, required: true },
  target: { type: String, required: true },
  sourceX: { type: Number, required: true },
  sourceY: { type: Number, required: true },
  targetX: { type: Number, required: true },
  targetY: { type: Number, required: true },
  sourcePosition: { type: String, required: true },
  targetPosition: { type: String, required: true },
  data: { type: Object, default: () => ({}) },
  style: { type: Object, default: undefined },
})

const path = computed(() => getSmoothStepPath(props))

const { findNode } = useVueFlow()

// Each exposed port as "child · label", its label its own, else the child port's.
const entries = computed(() => {
  const ends = exposureEnds({ ...props, type: EXPOSURE_EDGE_TYPE }, new Map([props.source, props.target].map((id) => [id, findNode(id)])))
  const ports = ends?.child?.data?.ports ?? []
  const owner = ends?.child?.data?.name
  return [...(props.data?.exposed ?? [])]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((entry) =>
      ownedLabel(owner, entry.label ?? entry.alias.label ?? ports.find((port) => port.exposedPortId === entry.alias.via)?.label ?? entry.id)
    )
})
</script>

<style scoped>
:global(.vue-flow__edge-path.exposure-edge) {
  stroke-dasharray: 6 4;
}

.exposure-edge-label {
  position: absolute;
  /* Clicks fall through to the line, whose double-click opens the Expose Ports dialog */
  pointer-events: none;
  max-width: 14rem;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--p-content-background);
  color: var(--p-text-muted-color);
  font-size: 11px;
  font-style: italic;
  white-space: nowrap;
}
</style>
