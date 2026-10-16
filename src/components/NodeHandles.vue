<template>
  <template v-for="handle in handles" :key="handle.uid">
    <Handle
      :id="getHandleId(handle)"
      :position="handlePosition(handle.side)"
      :class="[
        'handle',
        `handle--${handle.variant || 'default'}`,
        { 'handle--inert': handle.variant === HANDLE_VARIANT.GHOST && selected && isCornerHandle(handle, handles) },
      ]"
      :style="getHandleStyle(handle, handles)"
      v-tooltip.bottom="{ value: handle.name, showDelay: 1000 }"
      @mouseenter="onHandleEnter(handle.uid)"
      @mouseleave="onHandleLeave"
      @pointerdown="onPointerDown(handle)"
    >
      <Button
        v-show="hoveredHandleUid === handle.uid && handle.variant !== HANDLE_VARIANT.GHOST"
        :class="['delete-handle-popover-btn', 'popover-' + handle.side]"
        icon="pi pi-trash"
        severity="danger"
        rounded
        text
        size="small"
        aria-label="Remove handle"
        @mouseenter="onHandleEnter(handle.uid)"
        @mouseleave="onHandleLeave"
        @mousedown.stop
        @dblclick.stop
        @click.stop="removeHandle(handle.uid)"
      />
    </Handle>
  </template>
</template>

<script setup>
/**
 * A node's handles, the same on every node: connection sites only. A ghost activates when a connection starts from it
 * (not a corner ghost while the node is selected, where the resizer is); a used handle offers, on hover, to turn back
 * into a ghost, removing its edges.
 */
import { Handle } from '@vue-flow/core'
import Button from 'primevue/button'

import { useNodeHandles } from '../composables/useNodeHandles'
import { HANDLE_VARIANT } from '../utils/constants'
import { getHandleId, getHandleStyle, handlePosition, isCornerHandle } from '../utils/handles'

const props = defineProps({
  id: {
    type: String,
    required: true,
  }, // The node's.
  handles: {
    type: Array,
    default: () => [],
  },
  selected: {
    type: Boolean,
    default: false,
  },
  // Whether a ghost can't activate, as while the node's name is edited.
  disabled: {
    type: Boolean,
    default: false,
  },
})

const { hoveredHandleUid, onHandleEnter, onHandleLeave, removeHandle, beginGhostActivation } = useNodeHandles(props)

/** Activates a ghost handle a connection starts from. */
function onPointerDown(handle) {
  if (props.disabled || handle.variant !== HANDLE_VARIANT.GHOST) return
  if (props.selected && isCornerHandle(handle, props.handles)) return
  beginGhostActivation(props.id, handle.uid)
}
</script>

<style lang="scss" scoped>
@use '../assets/nodehandles.scss';
</style>
