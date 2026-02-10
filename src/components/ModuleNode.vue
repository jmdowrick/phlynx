<template>
  <div
    class="module-node"
    :id="id"
    ref="moduleNode"
    :class="{ 
      selected: selected, 
      'compact-mode': isCompactMode 
    }"
    @contextmenu.stop.prevent="openContextMenu"
    @mousedown.capture="StopDrag"
  >
    <NodeResizer
      :min-width="NODE_SIZE_LIMITS.WIDTH"
      :min-height="NODE_SIZE_LIMITS.HEIGHT"
      :is-visible="selected && !isCompactMode"
    />

    <el-card :class="[domainTypeClass, 'module-card']" shadow="hover">
      <div v-if="isMissingParameters" class="status-indicator">
        <el-tooltip content="At least one parameter has not been assigned a value" placement="top" effect="light">
          <el-icon class="warning-icon">
            <WarningFilled />
          </el-icon>
        </el-tooltip>
      </div>

      <div 
        class="module-name"
        :class="{ 'compact-name': isCompactMode }"
        @dblclick="startEditing"
      >
        <span v-if="!isEditing">{{ displayName }}</span>
        <el-input
          v-else
          ref="inputRef"
          v-model="editingName"
          :size="isCompactMode ? 'default' : 'small'"
          @blur="saveEdit"
          @keyup.enter="saveEdit"
        />
      </div>

      <!-- non-editable label showing CellML component and source file (no white box) -->
      <!-- hide in compact mode -->
      <div v-if="data.label && !isCompactMode" class="module-label">
        {{ data.label }}
      </div>

      <!-- Buttons - dropdown in compact, full in normal -->
      <div v-if="!isCompactMode" class="button-group">
        <el-tooltip
          effect="dark"
          content="Set key (colour)"
          placement="bottom"
          :show-after="300"
          :auto-close="TOOLTIP_AUTO_CLOSE"
        >
          <el-dropdown trigger="click" @command="handleSetDomainType" @visible-change="(val) => isDropdownOpen = val">
            <el-button size="small" circle class="module-button">
              <el-icon><Key /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="membrane">Membrane</el-dropdown-item>
                <el-dropdown-item command="process">Process</el-dropdown-item>
                <el-dropdown-item command="compartment">Compartment</el-dropdown-item>
                <el-dropdown-item command="protein">Protein</el-dropdown-item>
                <el-dropdown-item command="undefined" divided>Reset to Default</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </el-tooltip>

        <el-tooltip
            class="box-item"
            effect="dark"
            content="Add port node"
            placement="bottom"
            :show-after="300"
            :auto-close="TOOLTIP_AUTO_CLOSE"
        >
          <el-dropdown trigger="click" @command="addPort({ side: $event })">
          
            <el-button size="small" circle class="module-button">
              <el-icon><Place /></el-icon>
            </el-button>
          
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="left">Left</el-dropdown-item>
                <el-dropdown-item command="right">Right</el-dropdown-item>
                <el-dropdown-item command="top">Top</el-dropdown-item>
                <el-dropdown-item command="bottom">Bottom</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </el-tooltip>
        <el-tooltip
            class="box-item"
            effect="dark"
            content="Edit port labels"
            placement="bottom"
            :show-after="300"
            :auto-close="TOOLTIP_AUTO_CLOSE"
        >
          <el-button
            size="small"
            circle
            @click="openEditDialog"
            class="module-button"
          >
            <el-icon><Edit /></el-icon>
          </el-button>
        </el-tooltip>

        <el-tooltip
            class="box-item"
            effect="dark"
            content="Edit parameters"
            placement="bottom"
            :show-after="300"
            :auto-close="TOOLTIP_AUTO_CLOSE"
        >
          <el-button size="small" circle @click="openEditParameterDialog" class="module-button">
            <el-icon><Operation /></el-icon>
          </el-button>
        </el-tooltip>

        <el-tooltip
            class="box-item"
            effect="dark"
            content="Edit CellML Text"
            placement="bottom"
            :show-after="300"
            :auto-close="TOOLTIP_AUTO_CLOSE"
        >
          <el-button
            size="small"
            circle
            @click="openCellMLEditDialog"
            class="module-button"
            :show-after="300"
            :auto-close="TOOLTIP_AUTO_CLOSE"
          >
            <el-icon><CellMLIcon /></el-icon>
          </el-button>
        </el-tooltip>
      </div>

      <div class="compact-actions">
        <el-dropdown trigger="click" @command="handleCompactAction">
          <el-button size="small" circle class="compact-menu-button">
            <el-icon><MoreFilled /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="setDomainType">
                <el-icon><Key /></el-icon>
                Set Key (Colour)
              </el-dropdown-item>
              <el-dropdown-item command="addPort">
                <el-icon><Place /></el-icon>
                Add Port
              </el-dropdown-item>
              <el-dropdown-item command="editPorts">
                <el-icon><Edit /></el-icon>
                Edit Port Labels
              </el-dropdown-item>
              <el-dropdown-item command="editParameters">
                <el-icon><Operation /></el-icon>
                Edit Parameters
              </el-dropdown-item>
              <el-dropdown-item command="editCellML">
                <el-icon><CellMLIcon /></el-icon>
                Edit CellML Text
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>

    </el-card>

    <template v-for="port in data.ports" :key="port.uid" class="port">
      <el-tooltip class="box-item" effect="dark" :content="port.name" placement="bottom" :show-after="1000">
        <Handle
          :id="getHandleId(port)"
          :ref="'handle_' + port.side + '_' + port.uid"
          :position="portPosition(port.side)"
          :style="getHandleStyle(port, data.ports)"
          class="port-handle"
        />
        <template #content>
          <el-button
            class="delete-port-btn"
            type="danger"
            :icon="Delete"
            circle
            plain
            size="small"
            @click.stop="removePort(port.uid)"
          />
        </template>
      </el-tooltip>
    </template>
    <!-- context menu -->
    <teleport to="body">
      <div
        v-if="contextMenuVisible"
        ref="contextMenu"
        class="context-menu"
        :style="{ top: contextMenuY + 'px', left: contextMenuX + 'px' }"
        @click.stop
      >
        <ul class="context-menu-list">
          <li @click="openReplacementDialog('replace')">Replace module</li>
        </ul>
      </div>
    </teleport>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onBeforeUnmount, ref } from 'vue'
import { Handle, useVueFlow } from '@vue-flow/core'
import { NodeResizer } from '@vue-flow/node-resizer'
import { Delete, Edit, Key, Place, MoreFilled, WarningFilled, Operation } from '@element-plus/icons-vue'
import CellMLIcon from './icons/CellMLIcon.vue'
import { useBuilderStore } from '../stores/builderStore'
import { useFlowHistoryStore } from '../stores/historyStore'
import { getHandleId, getHandleStyle, portPosition } from '../utils/ports'
import { sanitiseModuleName } from '../utils/nodes'
import { notify } from '../utils/notify'
import { isEditableVariableType, isEmpty } from '../utils/variables'
import { TOOLTIP_AUTO_CLOSE, ZOOM_BREAKPOINTS, NODE_SIZE_LIMITS } from '../utils/constants'
import '../assets/vueflownode.css'

const { addEdges, edges, viewport, removeEdges, updateNodeData, updateNodeInternals, nodes } = useVueFlow()
const historyStore = useFlowHistoryStore()
const builderStore = useBuilderStore()

const props = defineProps({
  data: {
    type: Object,
    required: true,
  },
  id: {
    type: String,
    required: true,
  },
  selected: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits([
  'open-cellml-editor-dialog',
  'open-edit-dialog',
  'open-replacement-dialog',
  'open-parameter-editor-dialog',
])

const moduleNode = ref(null)

// zoom-based display mode
const isCompactMode = computed(() => {
  const zoom = viewport.value.zoom
  return (zoom < ZOOM_BREAKPOINTS.COMPACT) 
})

const displayName = computed(() => {
  if (!props.data.name) return ''
  
  // In compact mode, insert zero-width space after underscores to allow breaks
  if (isCompactMode.value) {
    return props.data.name.replace(/_/g, '_\u200B')
  }
  
  return props.data.name
})

async function openEditDialog() {
  emit('open-edit-dialog', {
    nodeId: props.id,
    ports: props.data.ports,
    name: props.data.name,
    portOptions: props.data.portOptions,
    portLabels: props.data.portLabels,
  })
}

function openCellMLEditDialog() {
  emit('open-cellml-editor-dialog', {
    nodeId: props.id,
    name: props.data.name,
    sourceFile: props.data.sourceFile,
    componentName: props.data.componentName,
    configIndex: props.data.configIndex,
  })
}

function openEditParameterDialog() {
  emit('open-parameter-editor-dialog', {
    nodeId: props.id,
    instanceName: props.data.name,
    componentName: props.data.componentName,
    sourceFile: props.data.sourceFile,
  })
}

function handleCompactAction(command) {
  switch(command) {
    case 'setDomainType':
      // Show domain type submenu or modal
      break
    case 'addPort':
      // Show port direction submenu or modal
      break
    case 'editPorts':
      openEditDialog()
      break
    case 'editParameters':
      openEditParameterDialog()
      break
    case 'editCellML':
      openCellMLEditDialog()
      break
  }
}

const domainTypeClass = computed(() => {
  return props.data.domainType ? `domain-type-${props.data.domainType}` : 'domain-type-default'
})

const isMissingParameters = computed(() => {
  const name = props.data?.name
  if (!name) return true // If there's no source file, it's "missing" parameters

  for (const variable of props.data.variables || []) {
    if (isEditableVariableType(variable.type)) {
      if (variable.type === 'global_constant') {
        const globalConstant = builderStore.getGlobalConstant(variable.name)
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

function handleSetDomainType(typeCommand) {
  const newType = typeCommand === 'undefined' ? undefined : typeCommand
  updateNodeData(props.id, { domainType: newType })
}

const applyPorts = async (portsToSet) => {
  updateNodeData(props.id, { ports: portsToSet })

  // Changing ports adds/removes handles, so we MUST refresh internals
  await nextTick()
  updateNodeInternals(props.id)
}

async function removePort(portIdToRemove) {
  const oldPorts = JSON.parse(JSON.stringify(props.data.ports))

  const port = oldPorts.find((p) => p.uid === portIdToRemove)
  if (!port) return

  const handleId = getHandleId(port)

  // Find all edges connected to this specific port handle.
  // We need to snapshot these edge objects so we can restore them later
  const connectedEdges = edges.value.filter(
    (edge) =>
      (edge.source === props.id && edge.sourceHandle === handleId) ||
      (edge.target === props.id && edge.targetHandle === handleId)
  )

  const edgesSnapshot = connectedEdges.map((edge) => JSON.parse(JSON.stringify(edge)))

  // Define New Ports (for Redo)
  const newPorts = props.data.ports.filter((p) => p.uid !== portIdToRemove)

  // Add Composite Command to History
  historyStore.executeAndAddCommand({
    type: 'remove-port',
    undo: async () => {
      // Restore the port first (so the handle exists in the DOM).
      await applyPorts(oldPorts)

      // Then, restore the edges.
      if (edgesSnapshot.length > 0) {
        addEdges(edgesSnapshot)
      }
    },
    redo: async () => {
      // Remove the edges.
      if (edgesSnapshot.length > 0) {
        removeEdges(edgesSnapshot.map((e) => e.id))
      }

      // Then, remove the port
      await applyPorts(newPorts)
    },
  })
}

const addPort = async (portToAdd) => {
  const oldPorts = [...props.data.ports]
  // create stable node id
  const newPort = {
    ...portToAdd,
    uid: crypto.randomUUID(),
  }

  // Create a new array with the old ports + the new one
  const newPorts = [...props.data.ports, newPort]

  // Tell Vue Flow to update this node's data
  // This will cause the component to re-render
  await applyPorts(newPorts)

  historyStore.addCommand({
    type: 'add-port',
    undo: async () => {
      applyPorts(oldPorts)
    },
    redo: async () => {
      applyPorts(newPorts)
    },
  })
}

const isEditing = ref(false)
const editingName = ref('')
const inputRef = ref(null) // This is a template ref for the input

// This function is triggered by the double-click
async function startEditing(event) {

  // Don't allow module name editing in compact mode
  // if (isCompactMode.value) {
  //   return
  // }

  // Don't allow click-through to the flow pane
  event.stopPropagation()

  isEditing.value = true
  editingName.value = props.data.name

  // Wait for Vue to re-render and show the input
  await nextTick()

  // Focus the input
  inputRef.value?.focus()
}

function StopDrag(event) {
  if (isEditing.value) {
    event.stopPropagation()
  }
}

// This is triggered by pressing Enter or clicking away
function saveEdit() {
  if (!editingName.value || editingName.value.trim() === '') {
    isEditing.value = false
    return
  }

  const sanitisedName = sanitiseModuleName(editingName.value)

  if (!sanitisedName) {
    isEditing.value = false
    return
  }

  const nameExists = nodes.value.some((node) => node.id !== props.id && node.data && node.data.name === sanitisedName)

  if (nameExists) {
    notify.error({ message: 'A module with this name already exists.' })
    return
  }

  // Update the node's data in the store
  updateNodeData(props.id, { name: sanitisedName })
  isEditing.value = false
  setTimeout(() => {
    builderStore.setVariableParameterValuesForInstance(
      sanitisedName,
      props.data.variables,
      props.data.sourceFile,
      props.data.componentName,
      props.data.configIndex
    )
    updateNodeData(props.id, { variables: props.data.variables })
  }, 100) // Delay to ensure the DOM has updated
}

const contextMenuVisible = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)

const moduleListClickEl = ref(null)

function onDocumentPointerDown(event) {
  // If the pointer down is inside the context menu, do nothing
  const path = event.composedPath ? event.composedPath() : event.path || []
  const cm = document.querySelector('.context-menu')
  if (cm && path.includes(cm)) return
  closeContextMenu()
}

function removeMenuOpenListeners() {
  document.removeEventListener('click', closeContextMenu)
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  document.removeEventListener('dragstart', closeContextMenu)
  if (moduleListClickEl.value) {
    moduleListClickEl.value.removeEventListener('click', closeContextMenu)
    moduleListClickEl.value = null
  }
}

function closeContextMenu() {
  contextMenuVisible.value = false
  removeMenuOpenListeners()
}

onMounted(() => {
  document.addEventListener('module-context-open', handleExternalContextOpen)
  document.addEventListener('contextmenu', handleDocumentContextmenu)
})

onBeforeUnmount(() => {
  document.removeEventListener('module-context-open', handleExternalContextOpen)
  document.removeEventListener('contextmenu', handleDocumentContextmenu)
  removeMenuOpenListeners()
})

async function openContextMenu(event) {
  event.stopPropagation()
  event.preventDefault()

  let x = event.clientX
  let y = event.clientY

  const pad = 8
  const vw = window.innerWidth
  const vh = window.innerHeight
  const menuWidth = 150
  const menuHeight = 200
  if (x + menuWidth + pad > vw) x = vw - menuWidth - pad
  if (y + menuHeight + pad > vh) y = vh - menuHeight - pad

  contextMenuX.value = x
  contextMenuY.value = y
  contextMenuVisible.value = true

  await nextTick()

  // close when clicking elsewhere and pointer down/drag start
  document.addEventListener('click', closeContextMenu)
  document.addEventListener('dragstart', closeContextMenu)
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
}

async function openReplacementDialog() {
  emit('open-replacement-dialog', {
    nodeId: props.id,
    nodeData: props.data,
    name: props.data.name,
    portOptions: props.data.portOptions,
    portLabels: props.data.portLabels,
  })
  closeContextMenu()
}

// Close when another module opens a context menu or when right-click happens outside this node
function handleExternalContextOpen(e) {
  const openId = e?.detail?.nodeId ?? null
  if (openId !== props.id) {
    closeContextMenu()
  }
}

function handleDocumentContextmenu(e) {
  // If the right-click target is not inside this module node, close the menu.
  if (!moduleNode.value) return
  const path = e.composedPath ? e.composedPath() : e.path || []
  if (!path.includes(moduleNode.value)) {
    closeContextMenu()
  }
}
</script>

<style lang="scss" scoped>
@import '../assets/vueflowhandle.css';

.module-node {
  display: block;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border-radius: 10px;
}

.button-group {
  transition: opacity 0.3s ease, visibility 0.3s ease;
  opacity: 1;
  visibility: visible;
  transition-delay: 0.2s; 
}

.module-node.compact-mode .button-group {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition-delay: 0s; 
}

.module-node > .el-card,
.module-card {
  width: 100%;
  height: 100%;
  margin: 0;
  border-radius: 10px;
  box-sizing: border-box;
  position: relative;
  border: 3px solid rgba(0,0,0,0.04);
  display: flex;
  flex-direction: column;
  transition: border-width 0.3s ease;
}

.module-card :deep(.el-card__body) {
  transition: all 0.3s ease;
}

.module-node.compact-mode .el-card :deep(.el-card__body) {
  display: flex;
  flex-direction: column;
  justify-content: center;
  flex: 1;
  padding: 8px;
}

.status-indicator {
  position: absolute;
  top: 0px;
  right: 0px;
  z-index: 10;
  background-color: white;
  border-radius: 50%;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  transition: opacity 0.3s ease;
  transition-delay: 0s;
}

.module-name {
  font-size: 14px;
  transition: font-size 0.3s ease, 
              font-weight 0.3s ease, 
              padding 0.3s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &.compact-name {
    font-size: 18px;
    margin-left: 10px;
    font-weight: 600;
    padding: 8px 4px;
    white-space: normal;
    word-break: keep-all;
    overflow-wrap: break-word;
    line-height: 1.3;

    :deep(.el-input__wrapper) {
      font-size: 18px;
      padding: 8px 12px;
      min-height: 40px;
    }
    
    :deep(.el-input__inner) {
      font-size: 18px;
      font-weight: 600;
      text-align: center;
      white-space: normal;
      word-break: keep-all;
      overflow-wrap: break-word;
      line-height: 1.3;
    }
  }
}

.compact-actions {
  position: absolute;
  bottom: 8px;
  right: 8px;
  transition: opacity 0.2s ease;
  opacity: 0;
  pointer-events: none;
  transition-delay: 0s;
}

.module-node.compact-mode .compact-actions {
  opacity: 1;
  pointer-events: auto;
  transition-delay: 0.2s;
}

.module-node.compact-mode .warning-icon {
  font-size: 24px;
}

.module-node.compact-mode .status-indicator {
  top: 8px;
  right: 8px;
}

.warning-icon {
  color: var(--el-color-warning);
  font-size: 18px;
  cursor: help;
  transition: font-size 0.3s ease;

  &:hover {
    color: var(--el-color-warning-dark-2);
  }
}

.module-button {
  margin: 0;
}

.module-node {
  will-change: transform;
}
</style>
