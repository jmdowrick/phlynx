/**
 * Keeps every super instance in step with its super-module: its ports are materialised from the super-module's exposed
 * ports, and the couplings to them rebound by exposedPortId, never re-paired; a coupling whose exposed port is gone is
 * listed in its super instance's `broken` (see services/hierarchy/exposure.js materialiseSuperInstances). Whatever changes a
 * super-module, an edit, an undo or a redo, the super instances follow, outside history: they are derived, not edits.
 */
import { computed, effectScope, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import { materialiseSuperInstances } from '../services/hierarchy/exposure'
import { useFlowHistoryStore } from '../stores/historyStore'
import { FLOW_IDS } from '../utils/constants'

// A flow without nodes or edges, such as a stub of one, reads as empty.
const NONE = Object.freeze({ value: Object.freeze([]) })

// Each flow's sync, shared by every caller.
const syncs = new WeakMap()

/**
 * Starts keeping a flow's super instances in step, once per flow.
 *
 * @param {string} [flowId=FLOW_IDS.MAIN]
 * @returns {{sync: () => boolean}} sync brings them in step now, saying whether anything changed; a change is
 *   otherwise brought in before the next render.
 */
export function useSuperInstanceSync(flowId = FLOW_IDS.MAIN) {
  const flow = useVueFlow(flowId)
  // Outside any component, so no component's unmounting stops it for the others.
  if (!syncs.has(flow)) syncs.set(flow, effectScope(true).run(() => createSync(flow, flowId)))
  return syncs.get(flow)
}

/**
 * Builds a flow's sync.
 *
 * @param {Object} flow - From useVueFlow.
 * @param {string} flowId
 */
function createSync(flow, flowId) {
  const allNodes = () => (flow.nodes ?? flow.getNodes ?? NONE).value
  const allEdges = () => (flow.edges ?? flow.getEdges ?? NONE).value
  const pending = computed(() => materialiseSuperInstances(allNodes(), allEdges()))

  /** Writes the super instances' ports and broken lists, and the rebound couplings. */
  function apply({ nodes, couplings }) {
    for (const [id, fields] of nodes) {
      const node = flow.findNode(id)
      if (!node) continue
      const data = { ...node.data, ...fields }
      if (data.broken === undefined) delete data.broken
      node.data = data
    }
    for (const [id, next] of couplings) {
      const edge = flow.findEdge(id)
      if (edge) edge.data = { ...edge.data, couplings: next }
    }
  }

  /** @returns {boolean} Whether anything was out of step. */
  function sync() {
    const changes = materialiseSuperInstances(allNodes(), allEdges())
    if (!changes.nodes.size && !changes.couplings.size) return false
    // Found when used, so the workspace's store is the one active now.
    const history = flowId === FLOW_IDS.MAIN ? useFlowHistoryStore() : null
    if (history) history.withoutHistory(() => apply(changes))
    else apply(changes)
    return true
  }

  watch(
    pending,
    (changes) => {
      if (changes.nodes.size || changes.couplings.size) sync()
    },
    { immediate: true }
  )

  return { sync }
}
