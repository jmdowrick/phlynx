/**
 * The canvas: the nodes and edges on screen, which are the store's in the scope shown. The root is shown until
 * navigation into super-modules lands (H6), so `scope` is null and the canvas is the root's nodes and the edges
 * between them; a workspace without super-modules is all of its own. What lays out, selects, copies, drops, renames or
 * pictures nodes reads it; the model is useModelGraph's.
 */
import { computed, ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import { FLOW_IDS } from '../utils/constants'
import { nextNodeId as nextNodeIdIn, scopeOf } from '../utils/hierarchy'

// A flow without nodes or edges, such as a stub of one, reads as empty.
const NONE = Object.freeze({ value: Object.freeze([]) })

// Each flow's scope shown, shared by every caller.
const scopes = new WeakMap()

/**
 * Gives the nodes and edges a flow shows.
 *
 * @param {string} [flowId=FLOW_IDS.MAIN] - The flow; the workspace's by default.
 * @returns {{scope: import('vue').Ref<string|null>, nodes: import('vue').ComputedRef<Array>,
 *   edges: import('vue').ComputedRef<Array>, selectedNodes: import('vue').ComputedRef<Array>,
 *   selectedEdges: import('vue').ComputedRef<Array>, findNode: Function, nextNodeId: Function}} `scope` is the
 *   super-module shown, null at the root; `nodes` and `edges` are the store's own arrays while every node is in it.
 */
export function useActiveCanvas(flowId = FLOW_IDS.MAIN) {
  const flow = useVueFlow(flowId)
  if (!scopes.has(flow)) scopes.set(flow, ref(null))
  const scope = scopes.get(flow)

  // Read when used, so a flow's nodes and edges are found however it holds them.
  const allNodes = () => (flow.nodes ?? flow.getNodes ?? NONE).value
  const allEdges = () => (flow.edges ?? flow.getEdges ?? NONE).value
  const isShown = (node) => scopeOf(node) === scope.value

  const nodes = computed(() => {
    const all = allNodes()
    return all.every(isShown) ? all : all.filter(isShown)
  })
  const isEveryNodeShown = () => nodes.value === allNodes()
  /** @returns {(edge: Object) => boolean} Whether an edge joins two nodes on the canvas. */
  const isEdgeShown = () => {
    const ids = new Set(nodes.value.map((node) => node.id))
    return (edge) => ids.has(edge.source) && ids.has(edge.target)
  }
  const edges = computed(() => (isEveryNodeShown() ? allEdges() : allEdges().filter(isEdgeShown())))
  // Vue Flow's selection takes in nodes and edges off screen.
  const selectedNodes = computed(() => (flow.getSelectedNodes ?? NONE).value.filter(isShown))
  const selectedEdges = computed(() => {
    const selected = (flow.getSelectedEdges ?? NONE).value
    return isEveryNodeShown() ? selected : selected.filter(isEdgeShown())
  })

  /**
   * Finds a node on the canvas.
   *
   * @param {string} id
   * @returns {Object|undefined} Undefined for a node off screen.
   */
  const findNode = (id) => {
    const node = flow.findNode?.(id) ?? allNodes().find((candidate) => candidate.id === id)
    return node && isShown(node) ? node : undefined
  }

  /**
   * Gets the id for a node added to the canvas, unique in the store (see utils/hierarchy nextNodeId).
   *
   * @param {string} [prefix]
   * @returns {string}
   */
  const nextNodeId = (prefix) => nextNodeIdIn(scope.value, allNodes(), prefix)

  return { scope, nodes, edges, selectedNodes, selectedEdges, findNode, nextNodeId }
}
