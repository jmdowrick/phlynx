/**
 * Deletes canvas nodes as one undo step, first asking about what the deletion would break: a node an exposed port
 * aliases, or a super-module left without subsystems.
 */
import { computed } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import { useActiveCanvas } from './useActiveCanvas'
import { useFlowHistoryFor } from './useFlowHistoryFor'
import { useSupermodules } from './useSupermodules'
import { FLOW_IDS } from '../utils/constants'

/**
 * Gives a way to delete canvas nodes that asks first where Vue Flow's Delete key can't.
 *
 * @param {Object} options
 * @param {(options: Object) => Promise<boolean|null>} options.confirm - From useConfirmDialog: true to accept, false
 *   to reject, null when closed without an answer.
 * @param {Object} [options.history] - The undo stack; the nearest provided one by default.
 * @param {string} [options.flowId=FLOW_IDS.MAIN]
 * @returns {{selectionNeedsAsking: import('vue').ComputedRef<boolean>, deleteNodes: Function,
 *   deleteSelection: Function}}
 */
export function useCanvasDelete({ confirm, history = useFlowHistoryFor(), flowId = FLOW_IDS.MAIN }) {
  const { removeNodes, removeEdges, findNode, findEdge } = useVueFlow(flowId)
  const { selectedNodes, selectedEdges } = useActiveCanvas(flowId)
  const { orphanedBy, exposedBy, find, deleteSupermodule } = useSupermodules(flowId)

  // Whether deleting the canvas selection needs asking first, so the workspace turns Vue Flow's Delete key off.
  const selectionNeedsAsking = computed(() => {
    const ids = selectedNodes.value.map((node) => node.id)
    return orphanedBy(ids).length > 0 || exposedBy(ids).length > 0
  })

  const nameOf = (smId) => `'${find(smId)?.name ?? smId}'`

  /**
   * Asks whether to delete nodes that exposed ports alias, which leaves those ports aliasing nothing.
   *
   * @param {ReturnType<typeof exposedBy>} exposures
   * @returns {Promise<boolean|null>}
   */
  function askToBreakExposures(exposures) {
    const lines = exposures.map(
      ({ smId, nodeName, portLabel }) => `• '${nodeName}' (port '${portLabel}' of ${nameOf(smId)})`
    )
    return confirm({
      header: 'Delete Exposed Nodes?',
      message:
        `Exposed ports of a super-module alias these nodes:\n${lines.join('\n')}\n` +
        'Deleting them leaves those ports, and connections to them, without a module behind them.',
      severity: 'warning',
      acceptLabel: 'Delete anyway',
      rejectLabel: 'Cancel',
    })
  }

  /**
   * Asks whether super-modules left without subsystems go too.
   *
   * @param {string[]} smIds
   * @returns {Promise<boolean|null>}
   */
  function askToDeleteSupermodules(smIds) {
    const names = smIds.map(nameOf).join(', ')
    const one = smIds.length === 1
    return confirm({
      header: one ? 'Delete Super-module Too?' : 'Delete Super-modules Too?',
      message:
        `No other subsystem uses the super-module${one ? '' : 's'} ${names}. ` +
        `Delete ${one ? 'it' : 'them'} as well, or keep ${one ? 'it' : 'them'} in the palette to place again?`,
      severity: 'warning',
      acceptLabel: one ? 'Delete super-module' : 'Delete super-modules',
      rejectLabel: one ? 'Keep super-module' : 'Keep super-modules',
    })
  }

  /**
   * Deletes canvas nodes and edges as one undo step, once the user agrees to break exposed ports and says whether
   * super-modules left without subsystems go too. Closing a question without an answer deletes nothing. What changed
   * while a question was open is checked again, so only what still exists is deleted.
   *
   * @param {string[]} nodeIds
   * @param {string[]} [edgeIds=[]]
   */
  async function deleteNodes(nodeIds, edgeIds = []) {
    const exposures = exposedBy(nodeIds)
    if (exposures.length && !(await askToBreakExposures(exposures))) return
    const orphaned = orphanedBy(nodeIds)
    const answer = orphaned.length > 0 ? await askToDeleteSupermodules(orphaned) : false
    if (answer == null) return

    const nodesLeft = nodeIds.filter((id) => findNode(id))
    const edgesLeft = edgeIds.filter((id) => findEdge(id))
    const stillOrphaned = answer ? orphanedBy(nodesLeft).filter((smId) => orphaned.includes(smId)) : []
    if (!nodesLeft.length && !edgesLeft.length) return
    history.startBatch()
    try {
      if (nodesLeft.length) removeNodes(nodesLeft)
      if (edgesLeft.length) removeEdges(edgesLeft)
      stillOrphaned.forEach(deleteSupermodule)
    } finally {
      history.endBatch()
    }
  }

  /** Deletes the canvas selection, as the Delete key does. */
  const deleteSelection = () =>
    deleteNodes(
      selectedNodes.value.map((node) => node.id),
      selectedEdges.value.map((edge) => edge.id)
    )

  return { selectionNeedsAsking, deleteNodes, deleteSelection }
}
