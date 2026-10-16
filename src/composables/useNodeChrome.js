/**
 * What InstanceNode and SubsystemNode share: in-place renaming unique on the canvas, removable port handles, theme
 * colour, simulated outline and context menu.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import { useActiveCanvas } from './useActiveCanvas'
import { useCanvasLevel } from './useCanvasLevel'
import { useFlowHistoryFor } from './useFlowHistoryFor'
import { useHandleManagement } from './useHandleManagement'
import { useNodeDataHistory } from './useNodeDataHistory'
import { useNodeThemeStore } from '../stores/nodeThemeStore'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { HANDLE_VARIANT } from '../utils/constants'
import { getHandleId } from '../utils/handles'
import { localNameProblem } from '../utils/hierarchy'
import { sanitiseName } from '../utils/identifiers'
import { categoryStyle as themeCategoryStyle } from '../utils/nodeThemes'
import { notify } from '../utils/notify'
import { detachReactivity } from '../utils/reactivity'

// Short enough to feel immediate; a slower double-click is caught by DOUBLE_CLICK_WINDOW_MS instead.
const RENAME_CLICK_DELAY_MS = 250
// Covers the default OS double-click interval (500ms on Windows and macOS).
const DOUBLE_CLICK_WINDOW_MS = 500
// How long a pointer rests on a handle before its remove button shows, and the grace to reach the button.
const HANDLE_HOVER_DELAY_MS = 1000
const HANDLE_LEAVE_DELAY_MS = 150

/**
 * Gives a node card its shared behaviour. Call it in the card's setup.
 *
 * @param {Object} props - The card's props: `id`, `data` (`name`, `handles`, `domainType`).
 * @param {Function} emit - The card's emit; `open-context-menu` is emitted with `{clientX, clientY, id}`.
 * @param {Object} options
 * @param {Function} options.onDoubleClick - What a double-click on the card does, a pending rename dropped first.
 * @param {boolean} [options.isSubsystem=false] - Whether the node is a subsystem, whose name follows the rules for
 *   names inside super-modules wherever it is.
 * @param {string} [options.nameTakenMessage] - The error shown when another node on the canvas has the name.
 */
export function useNodeChrome(
  props,
  emit,
  { onDoubleClick, isSubsystem = false, nameTakenMessage = 'An instance with this name already exists.' }
) {
  const { id: flowId, addEdges, edges, removeEdges, updateNodeData, updateNodeInternals, viewport } = useVueFlow()
  const { scope, nodes: canvasNodes } = useActiveCanvas(flowId)
  const canvasLevel = useCanvasLevel(flowId)
  const { beginGhostActivation, revertPendingGhostIfUnused } = useHandleManagement()
  const { recordEdit } = useNodeDataHistory(flowId)
  const historyStore = useFlowHistoryFor()
  const nodeThemeStore = useNodeThemeStore()
  const simulationResultsStore = useSimulationResultsStore()

  // Outlined while the Simulation tab shows results of a selection that includes it, or any module inside it.
  const isSimulated = computed(() => {
    const scopeNodeIds = simulationResultsStore.results && simulationResultsStore.scopeNodeIds
    if (!scopeNodeIds) return false
    return canvasLevel.modelIdsOf([props.id]).some((id) => scopeNodeIds.includes(id))
  })

  // The node stores a category key; the active theme decides its colour (none when the theme lacks it).
  const categoryStyle = computed(() => themeCategoryStyle(nodeThemeStore.activeTheme, props.data.domainType))

  // ─── Name ──────────────────────────────────────────────────────────────────────

  const isEditing = ref(false)
  const editingName = ref('')
  const nameInputRef = ref(null)
  let renameClickTimeout = null
  let renameClickedAt = 0

  // Panning or zooming the canvas moves the field without a scroll or resize event, so re-anchor the popover.
  watch(viewport, () => {
    if (isEditing.value) nameInputRef.value?.updatePosition()
  })

  /**
   * Starts renaming a moment after a single click, so a double-click does the card's double-click instead.
   *
   * @param {MouseEvent} event
   */
  function onNameClick(event) {
    clearTimeout(renameClickTimeout)
    renameClickTimeout = null
    // A keyboard activation has no click count.
    if (event.detail === 0) {
      startEditing()
    } else if (event.detail === 1) {
      renameClickedAt = Date.now()
      renameClickTimeout = setTimeout(() => {
        renameClickTimeout = null
        startEditing()
      }, RENAME_CLICK_DELAY_MS)
    }
  }

  /** Does the card's double-click, dropping any rename a first click had scheduled. */
  function onNodeDoubleClick() {
    clearTimeout(renameClickTimeout)
    renameClickTimeout = null
    onDoubleClick()
  }

  /**
   * Treats a double-click that lands on a field a click just opened as a double-click on the name, so a double-click
   * slower than the rename delay still does the card's double-click.
   */
  function onNameInputDoubleClick() {
    if (Date.now() - renameClickedAt >= DOUBLE_CLICK_WINDOW_MS) return
    renameClickedAt = 0
    cancelEdit()
    onDoubleClick()
  }

  /** Swaps the name for a field holding it, with the cursor in it. */
  async function startEditing() {
    isEditing.value = true
    editingName.value = props.data.name

    await nextTick()
    nameInputRef.value?.focus()
  }

  /** Keeps the card from being dragged while its name is edited. */
  function stopDragWhileEditing(event) {
    if (isEditing.value) event.stopPropagation()
  }

  /** Renames the node to the field's name, as one undo step; an empty name leaves it as it was. Enter or blur. */
  function saveEdit() {
    // Unmounting the field can fire a late blur, so ignore commits once editing has ended.
    if (!isEditing.value) return
    revertPendingGhostIfUnused()
    if (!editingName.value || editingName.value.trim() === '') {
      isEditing.value = false
      return
    }

    const sanitisedName = sanitiseName(editingName.value)

    if (!sanitisedName) {
      isEditing.value = false
      return
    }

    const nameProblem = localNameProblem(sanitisedName, { scope: scope.value, subsystem: isSubsystem })
    if (nameProblem) {
      notify.error({ message: nameProblem })
      return
    }

    const nameExists = canvasNodes.value.some((node) => node.id !== props.id && node.data && node.data.name === sanitisedName)

    if (nameExists) {
      notify.error({ message: nameTakenMessage })
      return
    }

    recordEdit({
      type: 'rename-node',
      nodeIds: [props.id],
      keys: ['name'],
      apply: () => updateNodeData(props.id, { name: sanitisedName }),
    })
    isEditing.value = false
  }

  /** Leaves the name as it was. Escape. */
  function cancelEdit() {
    isEditing.value = false
  }

  onBeforeUnmount(() => clearTimeout(renameClickTimeout))

  // ─── Handles ───────────────────────────────────────────────────────────────────

  const hoveredHandleUid = ref(null)
  let enterTimeout = null
  let leaveTimeout = null

  /** Shows a handle's remove button once the pointer rests on it. */
  function onHandleEnter(uid) {
    // Cancel the hide timer if the pointer came back quickly.
    clearTimeout(leaveTimeout)
    if (hoveredHandleUid.value !== uid) {
      enterTimeout = setTimeout(() => {
        hoveredHandleUid.value = uid
      }, HANDLE_HOVER_DELAY_MS)
    }
  }

  /** Hides the remove button, after a grace period to reach it. */
  function onHandleLeave() {
    clearTimeout(enterTimeout)
    leaveTimeout = setTimeout(() => {
      hoveredHandleUid.value = null
    }, HANDLE_LEAVE_DELAY_MS)
  }

  const applyHandles = async (handlesToSet) => {
    updateNodeData(props.id, { handles: handlesToSet })
    await nextTick()
    updateNodeInternals(props.id)
  }

  /**
   * Turns a handle back into a ghost and removes the edges on it, as one undo step.
   *
   * @param {string} handleIdToRemove - The handle's uid.
   */
  async function removeHandle(handleIdToRemove) {
    const oldHandles = detachReactivity(props.data.handles)

    const handle = oldHandles.find((h) => h.uid === handleIdToRemove)
    if (!handle) return

    const handleId = getHandleId(handle)

    // The edges on this handle, copied so undo can put them back.
    const connectedEdges = edges.value.filter(
      (edge) =>
        (edge.source === props.id && edge.sourceHandle === handleId) ||
        (edge.target === props.id && edge.targetHandle === handleId)
    )

    const edgesSnapshot = connectedEdges.map((edge) => detachReactivity(edge))

    const newHandles = props.data.handles.map((h) =>
      h.uid === handleIdToRemove ? { ...h, variant: HANDLE_VARIANT.GHOST } : h
    )

    historyStore.executeAndAddCommand({
      type: 'remove-handle',
      undo: async () => {
        // Restore the handle first, so it exists in the DOM, then its edges.
        await applyHandles(oldHandles)
        if (edgesSnapshot.length > 0) {
          addEdges(edgesSnapshot)
        }
      },
      redo: async () => {
        if (edgesSnapshot.length > 0) {
          removeEdges(edgesSnapshot.map((e) => e.id))
        }
        await applyHandles(newHandles)
      },
    })
  }

  /** @param {MouseEvent} event - A right-click on the card. */
  function openContextMenu(event) {
    emit('open-context-menu', {
      clientX: event.clientX,
      clientY: event.clientY,
      id: props.id,
    })
  }

  return {
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
    hoveredHandleUid,
    onHandleEnter,
    onHandleLeave,
    removeHandle,
    beginGhostActivation,
    openContextMenu,
  }
}
