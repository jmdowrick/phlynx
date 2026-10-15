<template>
  <div
    class="instance-node"
    :id="id"
    ref="instanceNode"
    :class="{ selected: selected, 'instance-node--simulated': isSimulated }"
    @contextmenu.stop.prevent="openContextMenu"
    @mousedown.capture="stopDragWhileEditing"
    @dblclick="onNodeDoubleClick"
  >
    <NodeResizer min-width="200" min-height="120" :is-visible="selected" />

    <div :class="['instance-card', { 'has-category': categoryStyle }]" :style="categoryStyle">
      <!-- Top Actions Row -->
      <div class="card-header-actions">
        <div class="instance-details">
          <div class="detail-item">
            <i class="pi pi-box detail-icon"></i>
            <span class="detail-value">{{ componentName }}</span>
          </div>
          <div class="detail-item">
            <i class="pi pi-file detail-icon"></i>
            <span class="detail-value">{{ mathFile }}</span>
          </div>
        </div>
        <div style="flex-grow: 1; min-width: 1.5em;"></div> <!-- Spacer to push buttons to the right -->
        <div v-if="isMissingParameters || isMissingUnits" class="status-indicator">
          <i
            class="pi pi-exclamation-triangle warning-icon"
            v-tooltip.top="`At least one ${isMissingParameters ? 'parameter' : 'unit'} has not been ${isMissingParameters ? 'assigned a value' : 'given a valid definition'}`"
          ></i>
        </div>
        <Button
          rounded
          iconOnly
          size="small"
          severity="secondary"
          class="instance-button"
          icon="pi pi-pencil"
          @click="openInstanceEditor('parameters')"
          @dblclick.stop
          v-tooltip.bottom="{ value: 'Edit instance', showDelay: 300 }"
        />
      </div>

      <!-- Node Title Block -->
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

    <template v-for="handle in data.handles" :key="handle.uid">
      <Handle
        :id="getHandleId(handle)"
        :ref="'handle_' + handle.side + '_' + handle.uid"
        :position="handlePosition(handle.side)"
        :class="['handle',
        `handle--${handle.variant|| 'default'}`,
        { 'handle--inert': handle.variant === HANDLE_VARIANT.GHOST && selected && isCornerHandle(handle, data.handles)},
        ]"
        :style="getHandleStyle(handle, data.handles)"
        v-tooltip.bottom="{ value: handle.name, showDelay: 1000 }"
        @mouseenter="onHandleEnter(handle.uid)"
        @mouseleave="onHandleLeave"
        @pointerdown="!isEditing && !(selected && isCornerHandle(handle, data.handles)) && handle.variant === HANDLE_VARIANT.GHOST && beginGhostActivation(props.id, handle.uid)"
      >
        <Button
          v-show="hoveredHandleUid === handle.uid && handle.variant !== HANDLE_VARIANT.GHOST"
          :class="['delete-handle-popover-btn', 'popover-' + handle.side]"
          icon="pi pi-trash"
          severity="danger"
          rounded
          text
          size="small"
          @mouseenter="onHandleEnter(handle.uid)"
          @mouseleave="onHandleLeave"
          @mousedown.stop
          @dblclick.stop
          @click.stop="removeHandle(handle.uid)"
        />
      </Handle>
    </template>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { Handle } from '@vue-flow/core'
import { NodeResizer } from '@vue-flow/node-resizer'
import Button from 'primevue/button'

import SanitisedInput from './SanitisedInput.vue'
import { useLibraryStore } from '../stores/libraryStore'
import { getHandleId, getHandleStyle, handlePosition, isCornerHandle } from '../utils/handles'
import { sanitiseName } from '../utils/identifiers'
import { isEditableVariableType, isEmpty } from '../utils/variables'
import { isUnitKnown } from '../utils/parameterRows'
import { HANDLE_VARIANT } from '../utils/constants'
import { useNodeChrome } from '../composables/useNodeChrome'

import '../assets/vueflownode.css'

const libraryStore = useLibraryStore()

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
  }, // { handles, variables, mathRef, moduleRef, ports, name }
})

const emit = defineEmits([
  'open-instance-editor',
  'open-context-menu',
])

// Name editing, handles, theme, simulated outline and context menu, shared with SubsystemNode.
const {
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
  hoveredHandleUid,
  onHandleEnter,
  onHandleLeave,
  removeHandle,
  beginGhostActivation,
  openContextMenu,
} = useNodeChrome(props, emit, { onDoubleClick: () => openInstanceEditor('parameters') })

function openInstanceEditor(defaultTab = 'parameters') {
  emit('open-instance-editor', {
    id: props.id,
    name: props.data.name,
    mathRef: props.data.mathRef,
    variables: props.data.variables,
    ports: props.data.ports,
    handles: props.data.handles,
    defaultTab,
  })
}

// Computed, so the card follows a save that moves the node to new math.
const componentName = computed(() => props.data.mathRef.split(':')[1])

const mathFile = computed(() => props.data.mathRef.split(':')[0])

const isMissingParameters = computed(() => {
  for (const variable of props.data.variables || []) {
    if (isEditableVariableType(variable.type)) {
      if (variable.type === 'global_constant') {
        const globalConstant = libraryStore.getGlobalConstant(variable.name)
        if (isEmpty(globalConstant?.value)) {
          return true
        }
      } else if (isEmpty(variable.value)) {
        return true
      }
    }
  }
  return false
})

const isMissingUnits = computed(() => {
  for (const variable of props.data.variables || []) {
    if (isEditableVariableType(variable.type)) {
      if (isEmpty(variable.units)) {
        return true
      } else if (!isUnitKnown(variable, libraryStore.availableUnitNames)) {
        return true
      }
    }
  }
  return false
})

const portMenuRef = ref(null)

function togglePortMenu(event) {
  portMenuRef.value?.toggle(event)
}
</script>

<style lang="scss" scoped>
@use '../assets/nodechrome.scss';
@import '../assets/vueflowhandle.css';
</style>

<style>
.content-fit-menu {
  width: max-content !important; 
  min-width: 0 !important; 
}
.vue-flow__node {
  background: transparent !important;
}
</style>
