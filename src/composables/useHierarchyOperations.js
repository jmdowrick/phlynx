/**
 * Structural edits of the hierarchy on the workspace (see services/hierarchy/operations.js): Make unique, Nest
 * selection and Un-nest. Each is one undo step: the new nodes and edges are added before the old ones are removed, so
 * no global constant a moved node uses is cleaned up, and the sliders, plots, sweeps and inspection variables of the
 * modules moved follow them to their new model ids.
 */
import { useVueFlow } from '@vue-flow/core'

import { useFlowHistoryFor } from './useFlowHistoryFor'
import { useSupermodules } from './useSupermodules'
import { makeUnique, modelIdMap, nestProblem, nestSelection, unnest, unnestProblem } from '../services/hierarchy/operations'
import { remapNodeKeys } from '../services/hierarchy/remapKeys'
import { FLOW_IDS } from '../utils/constants'
import { isSubsystem } from '../utils/hierarchy'
import { detachReactivity } from '../utils/reactivity'

// A flow without nodes or edges, such as a stub of one, reads as empty.
const NONE = Object.freeze({ value: Object.freeze([]) })

/** @returns {Promise<void>} Resolves once the changes queued now, and those they queue, have run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** @returns {boolean} Whether two plain values are the same, as saved. */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// The fields of an edge kept in place that an edit may change.
const EDGE_FIELDS = ['data', 'sourceHandle', 'targetHandle']

/**
 * Gives the structural edits of a flow's hierarchy.
 *
 * @param {Object} [options]
 * @param {string} [options.flowId=FLOW_IDS.MAIN]
 * @param {Object} [options.history] - The undo stack; the nearest provided one by default.
 * @returns {{canMakeUnique: Function, makeUniqueSubsystem: Function, nestProblemOf: Function, nest: Function,
 *   unnestProblemOf: Function, unnestSubsystem: Function}}
 */
export function useHierarchyOperations({ flowId = FLOW_IDS.MAIN, history = useFlowHistoryFor() } = {}) {
  const flow = useVueFlow(flowId)
  const { find } = useSupermodules(flowId)
  const allNodes = () => (flow.nodes ?? flow.getNodes ?? NONE).value
  const allEdges = () => (flow.edges ?? flow.getEdges ?? NONE).value
  const store = () => ({ nodes: detachReactivity(allNodes()), edges: detachReactivity(allEdges()) })

  /**
   * Makes an edit's result the store's, as one undo step: the data of nodes and edges it keeps written, its new nodes
   * and edges added, then the old ones removed, and the keyed stores following the modules moved.
   *
   * @param {string} type - The undo step's.
   * @param {{nodes: Array, edges: Array}} before - The store the edit was planned on.
   * @param {Object} result - From an operation.
   * @returns {Promise<{done: boolean, problems: string[]}>}
   */
  async function apply(type, before, result) {
    if (result.problems.length) return { done: false, problems: result.problems }
    const { idMap, nameOf } = modelIdMap(before, result, result.rewrite)
    const nodeBefore = new Map(before.nodes.map((node) => [node.id, node]))
    const edgeBefore = new Map(before.edges.map((edge) => [edge.id, edge]))
    const nodeIds = new Set(result.nodes.map((node) => node.id))
    const edgeIds = new Set(result.edges.map((edge) => edge.id))

    const nodeData = result.nodes
      .filter((node) => nodeBefore.has(node.id) && !same(node.data, nodeBefore.get(node.id).data))
      .map((node) => ({ id: node.id, before: detachReactivity(nodeBefore.get(node.id).data), after: detachReactivity(node.data) }))
    const pick = (edge) => Object.fromEntries(EDGE_FIELDS.map((field) => [field, edge[field] === undefined ? null : detachReactivity(edge[field])]))
    const edgeFields = result.edges
      .filter((edge) => edgeBefore.has(edge.id) && !same(pick(edge), pick(edgeBefore.get(edge.id))))
      .map((edge) => ({ id: edge.id, before: pick(edgeBefore.get(edge.id)), after: pick(edge) }))
    const addedNodes = result.nodes.filter((node) => !nodeBefore.has(node.id))
    const addedEdges = result.edges.filter((edge) => !edgeBefore.has(edge.id))
    const removedNodeIds = before.nodes.filter((node) => !nodeIds.has(node.id)).map((node) => node.id)
    const removedEdgeIds = before.edges.filter((edge) => !edgeIds.has(edge.id)).map((edge) => edge.id)

    const write = (side) => {
      for (const change of nodeData) {
        const node = flow.findNode(change.id)
        if (node) node.data = detachReactivity(change[side])
      }
      for (const change of edgeFields) {
        const edge = flow.findEdge(change.id)
        if (!edge) continue
        for (const [field, value] of Object.entries(change[side])) {
          if (value === null) delete edge[field]
          else edge[field] = detachReactivity(value)
        }
      }
    }
    let keys = null
    history.startBatch()
    try {
      await history.executeAndAddCommand({
        type,
        redo: () => {
          write('after')
          if (keys) keys.restore('after')
          else keys = remapNodeKeys(idMap, nameOf)
        },
        undo: () => {
          write('before')
          keys?.restore('before')
        },
      })
      if (addedNodes.length) flow.addNodes(detachReactivity(addedNodes))
      if (addedEdges.length) flow.addEdges(detachReactivity(addedEdges))
      if (removedNodeIds.length) {
        // A super-module's interface node can't be deleted from the canvas, so it is removed here as one that can.
        flow.removeNodes(
          removedNodeIds.map((id) => {
            const node = flow.findNode(id)
            return node?.deletable === false ? { ...node, deletable: true } : id
          })
        )
      }
      const edgesLeft = removedEdgeIds.filter((id) => flow.findEdge(id))
      if (edgesLeft.length) flow.removeEdges(edgesLeft)
      // An edge removed ghosts its handles a tick later; those changes are part of this step too.
      await settle()
    } finally {
      history.endBatch()
    }
    return { done: true, problems: [], result }
  }

  /**
   * Whether a subsystem's super-module has more than one copy in the model, so making it unique changes anything.
   *
   * @param {Object|string} subsystem - The node or its id.
   * @returns {boolean}
   */
  function canMakeUnique(subsystem) {
    const node = typeof subsystem === 'string' ? flow.findNode(subsystem) : subsystem
    return isSubsystem(node) && (find(node.data.smId)?.occurrences ?? 0) > 1
  }

  /**
   * Gives a subsystem its own copy of its super-module (see operations.js makeUnique).
   *
   * @param {string} subsystemId
   * @returns {Promise<{done: boolean, problems: string[]}>}
   */
  function makeUniqueSubsystem(subsystemId) {
    const before = store()
    return apply('make-unique', before, makeUnique(before.nodes, before.edges, subsystemId))
  }

  /** @returns {string|null} Why some nodes can't be nested (see operations.js nestProblem). */
  const nestProblemOf = (ids) => nestProblem(allNodes(), ids)

  /**
   * Nests nodes into a new super-module, with one subsystem of it in their place (see operations.js nestSelection).
   *
   * @param {string[]} ids
   * @param {string} name - The super-module's and the subsystem's.
   * @returns {Promise<{done: boolean, problems: string[], result?: Object}>} `result.subsystemId` the new subsystem's.
   */
  function nest(ids, name) {
    const before = store()
    return apply('nest-selection', before, nestSelection(before.nodes, before.edges, ids, { name }))
  }

  /** @returns {string|null} Why a subsystem can't be un-nested (see operations.js unnestProblem). */
  const unnestProblemOf = (subsystemId) => unnestProblem(allNodes(), subsystemId)

  /**
   * Un-nests a subsystem: its super-module's children take its place (see operations.js unnest).
   *
   * @param {string} subsystemId
   * @returns {Promise<{done: boolean, problems: string[], result?: Object}>}
   */
  function unnestSubsystem(subsystemId) {
    const before = store()
    return apply('unnest', before, unnest(before.nodes, before.edges, subsystemId))
  }

  return { canMakeUnique, makeUniqueSubsystem, nestProblemOf, nest, unnestProblemOf, unnestSubsystem }
}
