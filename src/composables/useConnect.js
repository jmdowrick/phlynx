import { useVueFlow } from '@vue-flow/core'
import { useFlowHistoryStore } from '../stores/historyStore'
import { FLOW_IDS } from '../utils/constants'
import { buildUsedPortKeys, checkAndClaimCouplings, resolvePortCouplings } from '../utils/edges'
import { getHandleUidFromHandleId } from '../utils/handles'
import { notify } from '../utils/notify'
import { detachReactivity } from '../utils/reactivity'

/**
 * Registers the Vue Flow connect handler: validates a new connection, activates its handles,
 * asks before replacing an existing connection between the same instances, and adds the edge
 * with its resolved port couplings. A connection needing a port with no free slot is refused.
 *
 * @param {Object} options
 * @param {Set<string>} options.suppressedEdgeIds - Edge ids whose add/remove changes are not recorded.
 * @param {Function} options.confirm - Confirm dialog; resolves true to replace the existing edge.
 * @param {Object} options.edgeLineOptions - Default options merged into new edges.
 * @param {Function} options.confirmActivation - From useHandleManagement.
 * @param {Function} options.activateHandle - From useHandleManagement.
 * @param {Function} options.revertHandleIfUnused - From useHandleManagement.
 * @param {Function} options.revertHandlesForEdge - From useHandleManagement.
 * @param {Function} options.reactivateEdgeHandles - From useHandleManagement.
 * @param {string} [options.flowId=FLOW_IDS.MAIN]
 */
export function useConnect({
  suppressedEdgeIds,
  confirm,
  edgeLineOptions,
  confirmActivation,
  activateHandle,
  revertHandleIfUnused,
  revertHandlesForEdge,
  reactivateEdgeHandles,
  flowId = FLOW_IDS.MAIN,
}) {
  const { addEdges, edges, findNode, onConnect, removeEdges } = useVueFlow(flowId)
  const historyStore = useFlowHistoryStore()

  onConnect(async (connection) => {
    const sourceNode = findNode(connection.source)
    const targetNode = findNode(connection.target)

    if (!sourceNode || !targetNode) return
    if (sourceNode === targetNode) return

    const isExistingConnection = edges.value.find(
      (e) => e.sourceHandle === connection.sourceHandle && e.targetHandle === connection.targetHandle,
    )
    if (isExistingConnection) return

    const duplicate = edges.value.find((e) => e.source === connection.source && e.target === connection.target)

    const duplicateSnapshot = duplicate ? detachReactivity(duplicate) : null

    // Each repeated label takes its first slot no other edge holds; the edge this replaces holds none.
    const portsOf = (id) => findNode(id)?.data.ports ?? []
    const usedPortKeys = buildUsedPortKeys(edges.value.filter((e) => e !== duplicate), portsOf)
    const couplings = resolvePortCouplings(sourceNode.data.ports ?? [], targetNode.data.ports ?? [], {
      sourceId: connection.source,
      targetId: connection.target,
      usedPortKeys,
    })
    const nameOf = (id) => findNode(id)?.data.name ?? id
    const { valid, conflicts } = checkAndClaimCouplings(
      connection.source,
      connection.target,
      couplings,
      usedPortKeys,
      nameOf,
    )
    if (!valid) {
      notify.error({ title: 'Connection Not Made', message: conflicts.join(' ') })
      return
    }

    const sourceHandleUid = connection.sourceHandle ? getHandleUidFromHandleId(connection.sourceHandle) : null
    const targetHandleUid = connection.targetHandle ? getHandleUidFromHandleId(connection.targetHandle) : null

    confirmActivation()

    if (sourceHandleUid) {
      activateHandle(connection.source, sourceHandleUid, {
        trackHistory: false,
      })
    }
    if (targetHandleUid) {
      activateHandle(connection.target, targetHandleUid, {
        trackHistory: false,
      })
    }

    if (duplicate) {
      const pendingEdge = {
        ...connection,
        id: `pending--${connection.source}--${connection.target}`,
        style: { strokeDasharray: '8 8', opacity: 0.4 }, // visually mark "unconfirmed"
      }

      suppressedEdgeIds.add(pendingEdge.id)
      addEdges(pendingEdge)

      const shouldReplace = await confirm({
        header: 'Connection already exists',
        message:
          'A connection already exists between these instances. Do you wish to replace it?\n\n' +
          'If you select Cancel, the new connection will be discarded and the existing connection will remain.',
        severity: 'warning',
        acceptLabel: 'Replace',
        rejectLabel: 'Cancel',
      })

      if (!shouldReplace) {
        removeEdges(pendingEdge.id)
        suppressedEdgeIds.delete(pendingEdge.id)
        if (sourceHandleUid)
          revertHandleIfUnused(connection.source, sourceHandleUid, {
            trackHistory: false,
          })
        if (targetHandleUid)
          revertHandleIfUnused(connection.target, targetHandleUid, {
            trackHistory: false,
          })
        return
      }

      suppressedEdgeIds.add(duplicateSnapshot.id)
      await revertHandlesForEdge(duplicateSnapshot, [duplicateSnapshot.id], {
        trackHistory: false,
      })
      removeEdges(duplicateSnapshot.id)
      removeEdges(pendingEdge.id)
      suppressedEdgeIds.delete(pendingEdge.id)
    }

    const newEdge = {
      ...connection,
      ...edgeLineOptions,
      id: `${connection.source}--${connection.target}`,
      data: {
        couplings,
      },
    }

    if (duplicate) {
      suppressedEdgeIds.add(newEdge.id)
      addEdges(newEdge)
      suppressedEdgeIds.delete(duplicateSnapshot.id)
      suppressedEdgeIds.delete(newEdge.id)

      historyStore.addCommand({
        type: 'replace-edge',
        async undo() {
          await revertHandlesForEdge(newEdge, [newEdge.id], {
            trackHistory: false,
          })
          removeEdges(newEdge.id)
          addEdges(duplicateSnapshot)
          await reactivateEdgeHandles(duplicateSnapshot, {
            trackHistory: false,
          })
        },
        async redo() {
          await revertHandlesForEdge(duplicateSnapshot, [duplicateSnapshot.id], { trackHistory: false })
          removeEdges(duplicateSnapshot.id)
          addEdges(newEdge)
          await reactivateEdgeHandles(newEdge, { trackHistory: false })
        },
      })
    } else {
      addEdges(newEdge)
    }
  })
}
