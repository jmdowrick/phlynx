/**
 * The handle behaviour every node shares: a remove button on a handle the pointer rests on, removing turns the handle
 * back into a ghost, and a ghost handle activates on pointerdown.
 */
import { nextTick, onBeforeUnmount, ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import { useFlowHistoryFor } from './useFlowHistoryFor'
import { useHandleManagement } from './useHandleManagement'
import { HANDLE_VARIANT } from '../utils/constants'
import { getHandleId } from '../utils/handles'
import { detachReactivity } from '../utils/reactivity'

// How long a pointer rests on a handle before its remove button shows, and the grace to reach the button.
const HANDLE_HOVER_DELAY_MS = 1000
const HANDLE_LEAVE_DELAY_MS = 150

/**
 * Gives a node's handles their shared behaviour. Call it in the handles' setup.
 *
 * @param {Object} props - `id` (the node's) and `handles` (its handles).
 */
export function useNodeHandles(props) {
  const { addEdges, edges, removeEdges, updateNodeData, updateNodeInternals } = useVueFlow()
  const { beginGhostActivation } = useHandleManagement()
  const historyStore = useFlowHistoryFor()

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

  onBeforeUnmount(() => {
    clearTimeout(enterTimeout)
    clearTimeout(leaveTimeout)
  })

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
    const oldHandles = detachReactivity(props.handles)

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

    const newHandles = props.handles.map((h) => (h.uid === handleIdToRemove ? { ...h, variant: HANDLE_VARIANT.GHOST } : h))

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

  return { hoveredHandleUid, onHandleEnter, onHandleLeave, removeHandle, beginGhostActivation }
}
