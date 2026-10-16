/**
 * Brings a model node into view, as search does: enters the subsystems it is expanded through, then centres on it.
 */
import { watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import { useCanvasLevel } from './useCanvasLevel'
import { useModelGraph } from './useModelGraph'
import { FLOW_IDS } from '../utils/constants'

// How long a revealed node is waited on to be measured before the view is left where it is.
export const REVEAL_MEASURE_TIMEOUT_MS = 2000

/**
 * Gives a way to reveal a model node on the canvas.
 *
 * @param {(nodeId: string) => void} zoomToNode - Centres the view on a canvas node.
 * @param {string} [flowId=FLOW_IDS.MAIN]
 * @returns {(modelId: string) => void}
 */
export function useRevealModelNode(zoomToNode, flowId = FLOW_IDS.MAIN) {
  const { findNode } = useVueFlow(flowId)
  const canvasLevel = useCanvasLevel(flowId)
  const { graph } = useModelGraph(flowId)

  /**
   * Shows the scope a model node is in, from the root, and centres on its node there; again once it is measured, as a
   * node first shown by entering its subsystem isn't yet.
   *
   * @param {string} modelId
   */
  return function revealModelNode(modelId) {
    const from = graph.value.origin.get(modelId)
    if (!from) return
    canvasLevel.showInstanceChain(from.instanceChain, { restoreViewport: false })
    zoomToNode(from.mainId)
    if (findNode(from.mainId)?.dimensions?.width) return
    const stop = watch(
      () => findNode(from.mainId)?.dimensions?.width,
      (width) => {
        if (!width) return
        stop()
        zoomToNode(from.mainId)
      }
    )
    setTimeout(stop, REVEAL_MEASURE_TIMEOUT_MS)
  }
}
