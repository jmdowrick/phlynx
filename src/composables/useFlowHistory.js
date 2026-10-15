import { useVueFlow } from '@vue-flow/core'
import { useActiveCanvas } from './useActiveCanvas'
import { useCanvasLevel } from './useCanvasLevel'
import { useFlowHistoryFor } from './useFlowHistoryFor'
import { useSubsystemSync } from './useSubsystemSync'
import { useLibraryStore } from '../stores/libraryStore'
import { FLOW_IDS } from '../utils/constants'
import { assertNodeId, edgeScopeProblem, isSupermoduleInterface, withScopeFields } from '../utils/hierarchy'
import { detachReactivity } from '../utils/reactivity'

/**
 * Maps a keydown event to an undo or redo request: Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z and
 * Ctrl/Cmd+Y redo. Ignores whether there is anything to undo or redo.
 *
 * @param {KeyboardEvent} event
 * @returns {'undo'|'redo'|null}
 */
export function getUndoRedoAction(event) {
  const isCtrl = event.ctrlKey || event.metaKey
  const isShift = event.shiftKey
  const key = event.key.toLowerCase()

  if (isCtrl && !isShift && key === 'z') return 'undo'
  if (isCtrl && isShift && key === 'z') return 'redo'
  if (isCtrl && key === 'y') return 'redo'
  return null
}

/**
 * Turns Vue Flow node and edge changes into undo/redo commands on the history store, which go back to the canvas level
 * they were made at (see useCanvasLevel). Added nodes are stamped with the scope shown, their ids checked against it.
 * Subsystems are kept in step with their super-modules (see useSubsystemSync).
 *
 * @param {Object} options
 * @param {Set<string>} options.suppressedEdgeIds - Edge ids whose add/remove changes are not recorded.
 * @param {Function} options.indexAddEdge - Adds an edge to the node-edge index.
 * @param {Function} options.indexRemoveEdge - Removes an edge change from the node-edge index.
 * @param {Function} options.updateHelperLines - Updates alignment helper lines for node changes.
 * @param {Function} options.revertHandlesForEdge - From useHandleManagement.
 * @param {Function} options.reactivateEdgeHandles - From useHandleManagement.
 * @param {string} [options.flowId=FLOW_IDS.MAIN]
 * @returns {{ onNodeChange: Function, onEdgeChange: Function }}
 */
export function useFlowHistory({
  suppressedEdgeIds,
  indexAddEdge,
  indexRemoveEdge,
  updateHelperLines,
  revertHandlesForEdge,
  reactivateEdgeHandles,
  flowId = FLOW_IDS.MAIN,
}) {
  const { addEdges, addNodes, applyNodeChanges, applyEdgeChanges, findEdge, findNode, nodes, removeEdges, removeNodes } =
    useVueFlow(flowId)
  const historyStore = useFlowHistoryFor()
  const libraryStore = useLibraryStore()
  const { nodes: canvasNodes } = useActiveCanvas(flowId)
  const canvasLevel = useCanvasLevel(flowId)
  canvasLevel.bindHistory(historyStore)
  // Subsystems follow their super-modules after every change, undo and redo included.
  useSubsystemSync(flowId)

  const activeInteractionBuffer = new Map()
  const undoRedoSelection = false
  // The latest recorded add: its command, the node snapshots it restores and the visible ids still to be measured.
  let lastAdd = null

  const createSelectCommand = (changes, findFn) => {
    return {
      type: 'select',
      undo: () => {
        changes.forEach((s) => {
          const item = findFn(s.id)
          if (item) item.selected = s.from
        })
      },
      redo: () => {
        changes.forEach((s) => {
          const item = findFn(s.id)
          if (item) item.selected = s.to
        })
      },
    }
  }

  const snapshotEdge = (change) => {
    if (change.type === 'add') {
      return detachReactivity(change.item)
    }

    const edge = findEdge(change.id)
    if (!edge) return null

    // Create a deep copy to break reactivity references
    return detachReactivity(edge)
  }

  /**
   * Stamps an added node with the scope shown and its local id where it lacks them, and checks its id is theirs: ids
   * are made by nextNodeId in the scope a node goes to, never rewritten here. An interface node can't be deleted.
   *
   * @param {Object} change - An add change; its node's data is replaced where a field is filled in.
   * @throws {Error} When the node's id breaks the id rules or isn't its scope's and local id's.
   */
  const stampScope = (change) => {
    const node = change.item
    const data = withScopeFields(node, canvasLevel.scope.value)
    if (data !== node.data) node.data = data
    if (isSupermoduleInterface(node)) node.deletable = false
    assertNodeId(node)
  }

  /**
   * Removes nodes as undo and redo replay a change, a super-module's interface node (deletable: false) included,
   * which Vue Flow's removeNodes would keep.
   *
   * @param {string[]} ids
   */
  const removeNodesById = (ids) => {
    removeNodes(
      ids.map((id) => {
        const node = findNode(id)
        return node?.deletable === false ? { ...node, deletable: true } : id
      })
    )
  }

  const snapshotNode = (change) => {
    if (change.type === 'add') {
      // For added nodes, snapshot is the node itself
      return detachReactivity(change.item)
    }

    const node = findNode(change.id)
    if (!node) return null

    // Create a deep copy to break reactivity references
    return detachReactivity(node)
  }

  const processPositionChange = (c, buffer, moveChanges) => {
    if (c.position === undefined && c.from && buffer.has(c.id)) {
      // Drag End
      const start = buffer.get(c.id)
      const end = snapshotNode({ id: c.id })

      if (end && (start.position.x !== end.position.x || start.position.y !== end.position.y)) {
        moveChanges.push({ start, end })
      }
      buffer.delete(c.id)
    } else if (c.position && !buffer.has(c.id)) {
      // Drag Start
      const snap = snapshotNode({ id: c.id })
      if (snap) buffer.set(c.id, snap)
    }
  }

  const processDimensionChange = (c, buffer) => {
    // Only the added node's own first measurement re-records the add, and only while the add is
    // still pending; hidden nodes are never measured.
    if (historyStore.lastChangeWasAdd && lastAdd?.visibleIds.has(c.id)) {
      historyStore.lastChangeWasAddSetter(false)
      const node = snapshotNode(c)
      if (historyStore.isPending(lastAdd.command) && lastAdd.command.offset !== 'applied' && node) {
        node.position = {
          x: node.position.x - node.dimensions.width / 2,
          y: node.position.y - node.dimensions.height / 2,
        }
        // Rewrites the add in place, so the rest of its nodes and any later commands are kept.
        const index = lastAdd.nodes.findIndex((n) => n.id === node.id)
        lastAdd.nodes[index] = node
        lastAdd.command.offset = 'applied'
      }
    } else if (c.dimensions === undefined && buffer.has(c.id)) {
      const startSnapshot = buffer.get(c.id)
      const endSnapshot = snapshotNode({ id: c.id })

      // Only add command if dimensions actually changed
      if (
        endSnapshot &&
        (startSnapshot.dimensions.width !== endSnapshot.dimensions.width ||
          startSnapshot.dimensions.height !== endSnapshot.dimensions.height)
      ) {
        historyStore.addCommand({
          type: 'resize',
          undo: () => {
            const n = findNode(startSnapshot.id)
            if (n) {
              n.dimensions = startSnapshot.dimensions
              n.position = startSnapshot.position
              n.style = { ...startSnapshot.style }
            }
          },
          redo: () => {
            const n = findNode(endSnapshot.id)
            if (n) {
              n.dimensions = endSnapshot.dimensions
              n.position = endSnapshot.position
              n.style = { ...endSnapshot.style }
            }
          },
        })
      }
      buffer.delete(c.id)
    } else if (c.dimensions) {
      if (!buffer.has(c.id)) {
        const snap = snapshotNode({ id: c.id })
        if (snap) {
          buffer.set(c.id, snap)
        }
      }
    }
  }

  /**
   * Records node changes as undo steps, then applies them to the flow.
   *
   * @param {Array<Object>} changes - Vue Flow node changes.
   */
  const onNodeChange = (changes) => {
    const hasAdds = changes.some((c) => c.type === 'add')
    changes.forEach((c) => c.type === 'add' && stampScope(c))

    if (historyStore.isUndoRedoing) {
      // If we are currently undoing/redoing, bypass history tracking
      const applied = applyNodeChanges(changes)
      if (hasAdds) canvasLevel.syncVisibility()
      return applied
    }

    // Add node and dimension changes are single node events.
    // All other changes can be performed on multiple nodes in a change set.

    const addChanges = []
    const removeChanges = []
    const moveChanges = []
    const selectChanges = []
    changes.forEach((c) => {
      // Deal with the changes that we need to buffer first, which are the posiiton and dimension type changes.
      if (c.type === 'position') {
        processPositionChange(c, activeInteractionBuffer, moveChanges)
      } else if (c.type === 'dimensions') {
        processDimensionChange(c, activeInteractionBuffer)
      } else {
        // Non-active interaction buffer changes.
        activeInteractionBuffer.delete(c.id)
        if (c.type === 'add') {
          addChanges.push({ node: snapshotNode(c) })
        } else if (c.type === 'remove') {
          removeChanges.push({ node: snapshotNode(c) })
        } else if (c.type === 'select' && undoRedoSelection) {
          const node = findNode(c.id)
          if (node) {
            selectChanges.push({ id: c.id, from: node.selected, to: c.selected })
          }
        }
      }
    })

    if (moveChanges.length) {
      historyStore.addCommand({
        type: 'move',
        undo: () => {
          moveChanges.forEach((m) => {
            const n = findNode(m.start.id)
            if (n) n.position = m.start.position
          })
        },
        redo: () => {
          moveChanges.forEach((m) => {
            const n = findNode(m.end.id)
            if (n) n.position = m.end.position
          })
        },
      })
    }
    if (addChanges.length) {
      const nodesToAdd = addChanges.map((c) => c.node)
      const idsToRemove = addChanges.map((c) => c.node.id)
      const command = {
        type: 'add',
        offset: 'not-applied',
        undo: () => removeNodesById(idsToRemove),
        redo: () => addNodes(nodesToAdd),
      }
      // Nodes of another scope, such as a new super-module's interface, are never drawn, so never measured.
      const visibleIds = new Set(nodesToAdd.filter((n) => !n.hidden && canvasLevel.isShown(n)).map((n) => n.id))

      if (visibleIds.size) {
        lastAdd = { command, nodes: nodesToAdd, visibleIds }
        historyStore.lastChangeWasAddSetter(true)
      }
      historyStore.addCommand(command)
    }
    if (removeChanges.length) {
      const nodesToRestore = removeChanges.map((change) => change.node)
      const idsToRemove = new Set(removeChanges.map((change) => change.node.id))
      // Globals are cleaned up against the nodes left now, so re-iding a node (nest, un-nest) must add
      // the copy before removing the original.
      const remainingNodes = nodes.value.filter((n) => !idsToRemove.has(n.id))
      const removedConstants = libraryStore.cleanupUnusedGlobalConstants(remainingNodes)
      historyStore.addCommand({
        type: 'remove',
        undo: () => {
          addNodes(nodesToRestore)
          removedConstants.forEach((c) => {
            libraryStore.assignGlobalConstant(c.name, c.value, c.units, c.data_reference)
          })
        },
        redo: () => {
          removeNodesById(Array.from(idsToRemove))
          removedConstants.forEach((c) => {
            libraryStore.removeGlobalConstant(c.name)
          })
        },
      })
    }
    if (selectChanges.length) {
      historyStore.addCommand(createSelectCommand(selectChanges, findNode))
    }

    updateHelperLines(changes, canvasNodes.value)

    // Have Vue Flow update the graph
    applyNodeChanges(changes)
    if (hasAdds) canvasLevel.syncVisibility()
  }

  /**
   * Records edge changes as undo steps, then applies them to the flow.
   *
   * @param {Array<Object>} changes - Vue Flow edge changes.
   */
  const onEdgeChange = (changes) => {
    const hasAdds = changes.some((c) => c.type === 'add')
    if (import.meta.env.DEV && hasAdds) assertEdgeScopes(changes)

    if (historyStore.isUndoRedoing) {
      // If we are currently undoing/redoing, bypass history tracking
      const applied = applyEdgeChanges(changes)
      if (hasAdds) canvasLevel.syncVisibility()
      return applied
    }

    const removeChanges = []
    const addChanges = []
    const selectChanges = []
    changes.forEach((c) => {
      if (c.type === 'remove') {
        indexRemoveEdge(c)
        if (!suppressedEdgeIds.has(c.id)) {
          removeChanges.push({ edge: snapshotEdge(c) })
        }
      } else if (c.type === 'add') {
        indexAddEdge(c.item)
        if (!suppressedEdgeIds.has(c.item.id)) {
          addChanges.push({ edge: snapshotEdge(c) })
        }
      } else if (c.type === 'select' && undoRedoSelection) {
        const edge = findEdge(c.id)
        selectChanges.push({ id: c.id, from: edge.selected, to: c.selected })
      }
    })

    if (addChanges.length) {
      const edgesToRestore = addChanges.map((change) => change.edge)
      const idsToRemove = addChanges.map((change) => change.edge.id)
      historyStore.addCommand({
        undo: () => {
          removeEdges(idsToRemove)
          edgesToRestore.forEach((edge) => revertHandlesForEdge(edge, idsToRemove, { trackHistory: false }))
        },
        redo: () => {
          addEdges(edgesToRestore)
          edgesToRestore.forEach((edge) => reactivateEdgeHandles(edge, { trackHistory: false }))
        },
      })
    }

    if (removeChanges.length) {
      const edgesToRestore = removeChanges.map((change) => change.edge)
      const idsToRemove = removeChanges.map((change) => change.edge.id)

      // Ghost out any handle that no longer has an edge attached to it.
      // excludeEdgeIds is passed because edges.value hasn't actually
      // dropped these ids yet at this point.
      edgesToRestore.forEach((edge) => revertHandlesForEdge(edge, idsToRemove))

      historyStore.addCommand({
        undo: () => {
          addEdges(edgesToRestore)
          edgesToRestore.forEach((edge) => reactivateEdgeHandles(edge, { trackHistory: false }))
        },
        redo: () => {
          removeEdges(idsToRemove)
          edgesToRestore.forEach((edge) => revertHandlesForEdge(edge, idsToRemove, { trackHistory: false }))
        },
      })
    }

    if (selectChanges.length) {
      historyStore.addCommand(createSelectCommand(selectChanges, findEdge))
    }

    applyEdgeChanges(changes)
    if (hasAdds) canvasLevel.syncVisibility()
  }

  /**
   * Checks, in development, that no edge added joins two scopes.
   *
   * @param {Array<Object>} changes - Edge changes.
   * @throws {Error}
   */
  const assertEdgeScopes = (changes) => {
    const nodeById = { get: (id) => findNode(id) }
    for (const change of changes) {
      const problem = change.type === 'add' && edgeScopeProblem(change.item, nodeById)
      if (problem) throw new Error(problem)
    }
  }

  return { onNodeChange, onEdgeChange }
}
