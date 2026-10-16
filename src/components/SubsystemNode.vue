<template>
  <div
    class="instance-node subsystem-node"
    :id="id"
    :class="{ selected: selected, 'instance-node--simulated': isSimulated }"
    @contextmenu.stop.prevent="openContextMenu"
    @mousedown.capture="stopDragWhileEditing"
    @dblclick="onNodeDoubleClick"
  >
    <NodeResizer min-width="200" min-height="120" :is-visible="selected" />

    <div :class="['instance-card', 'subsystem-card', { 'has-category': categoryStyle }]" :style="categoryStyle">
      <div class="card-header-actions">
        <div class="instance-details">
          <div class="detail-item">
            <i class="pi pi-sitemap detail-icon"></i>
            <span v-if="supermodule" class="detail-value subsystem-supermodule" :title="`Super-module ${supermodule.label}`">
              {{ supermodule.label }}
            </span>
            <span v-else class="detail-value subsystem-supermodule subsystem-supermodule--missing">
              Missing super-module
            </span>
          </div>
          <div class="detail-item">
            <i class="pi pi-arrows-h detail-icon"></i>
            <span class="detail-value">{{ portCount }} port{{ portCount === 1 ? '' : 's' }}</span>
          </div>
        </div>
        <div style="flex-grow: 1; min-width: 1.5em"></div>
        <span
          v-if="supermodule"
          class="subsystem-count"
          role="img"
          :aria-label="countLabel"
          v-tooltip.top="{ value: countLabel, showDelay: 300 }"
        >×{{ supermodule.count }}</span>
        <Button
          rounded
          iconOnly
          size="small"
          severity="secondary"
          class="instance-button subsystem-open"
          icon="pi pi-sign-in"
          aria-label="Open subsystem"
          :disabled="!supermodule"
          @click="open"
          @dblclick.stop
          v-tooltip.bottom="{ value: 'Open subsystem', showDelay: 300 }"
        />
      </div>

      <div class="instance-name">
        <!-- Not a <button>: the SVG export leaves buttons out, and the name must be drawn. -->
        <span
          v-if="!isEditing"
          role="button"
          tabindex="0"
          class="name-text"
          :aria-label="`Rename ${data.name}`"
          @click="onNameClick"
          @keydown.enter.prevent="startEditing"
          @keydown.space.prevent="startEditing"
        >{{ data.name }}</span>
        <SanitisedInput
          v-else
          ref="nameInputRef"
          v-model="editingName"
          :sanitise="sanitiseName"
          floating
          class="nodrag"
          @dblclick.stop="onNameInputDoubleClick"
          @commit="saveEdit"
          @revert="cancelEdit"
        />
      </div>
    </div>

    <NodeHandles :id="id" :handles="data.handles" :selected="selected" :disabled="isEditing" />
  </div>
</template>

<script setup>
/**
 * A subsystem on the canvas: one instance of a super-module. Shows its name, its super-module and how many subsystems
 * that has, and its ports; double-click or Open shows the super-module's nodes, as this subsystem's.
 */
import { computed } from 'vue'
import { NodeResizer } from '@vue-flow/node-resizer'
import Button from 'primevue/button'

import NodeHandles from './NodeHandles.vue'
import SanitisedInput from './SanitisedInput.vue'
import { useCanvasLevel } from '../composables/useCanvasLevel'
import { useNodeChrome } from '../composables/useNodeChrome'
import { useSupermodules } from '../composables/useSupermodules'
import { sanitiseName } from '../utils/identifiers'

import '../assets/vueflownode.css'

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
  }, // { name, smId, ports, handles, overrides }
})

const emit = defineEmits(['open-context-menu'])

const {
  flowId,
  isSimulated,
  categoryStyle,
  isEditing,
  editingName,
  nameInputRef,
  onNameClick,
  onNodeDoubleClick,
  onNameInputDoubleClick,
  startEditing,
  stopDragWhileEditing,
  saveEdit,
  cancelEdit,
  openContextMenu,
} = useNodeChrome(props, emit, {
  onDoubleClick: () => open(),
  isSubsystem: true,
  nameTakenMessage: 'A node here already has this name.',
})
const canvasLevel = useCanvasLevel(flowId)
const { find } = useSupermodules(flowId)

// Its super-module's entry: name, label and subsystem count; undefined when missing.
const supermodule = computed(() => find(props.data.smId))
const portCount = computed(() => props.data.ports?.length ?? 0)
const countLabel = computed(() => {
  const count = supermodule.value?.count ?? 0
  return `${count} super instance${count === 1 ? '' : 's'} of ${supermodule.value?.name ?? 'this super-module'}`
})

/** Shows the super-module's nodes, as this subsystem's. */
function open() {
  canvasLevel.enter(props.id)
}
</script>

<style lang="scss" scoped>
@use '../assets/nodechrome.scss';
@import '../assets/vueflowhandle.css';

/* A second edge just inside the instance card's own, so it reads as nested at exactly an instance card's size. */
.subsystem-card {
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--p-text-color) 22%, transparent),
    0 1px 2px color-mix(in srgb, var(--p-text-color) 6%, transparent);
}

.subsystem-card:hover {
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--p-text-color) 22%, transparent),
    0 4px 10px color-mix(in srgb, var(--p-text-color) 12%, transparent);
}

.selected .subsystem-card {
  box-shadow:
    inset 0 0 0 1px #409eff, /* the selection border, vueflownode.css */
    0 1px 2px color-mix(in srgb, var(--p-text-color) 6%, transparent);
}

.subsystem-supermodule--missing {
  color: var(--p-orange-500);
}

.subsystem-count {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  height: 1.6rem;
  padding: 0 0.45rem;
  border-radius: 999px;
  box-sizing: border-box;
  background: color-mix(in srgb, var(--p-text-color) 8%, transparent);
  color: color-mix(in srgb, var(--p-text-color) 75%, transparent);
  font-size: 0.75rem;
  font-weight: 600;
}
</style>
