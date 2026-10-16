import { useVueFlow } from '@vue-flow/core'
import { useActiveCanvas } from '../../composables/useActiveCanvas'
import { FLOW_IDS, GHOST_NODE_TYPE } from '../../utils/constants'
import { localIdOf, nodeIdOf, scopeOf, toLocalName } from '../../utils/hierarchy'
import { generateUniqueInstanceName } from '../../utils/nodes'

// Helper to get the bounding width of the macro graph
function getGraphWidth(nodes) {
  if (!nodes.length) return 0

  // Find min X and max X (considering width)
  let minX = Infinity
  let maxX = -Infinity

  nodes.forEach((node) => {
    const x = node.position.x
    const w = node.dimensions?.width || node.width || 150 // Fallback width
    if (x < minX) minX = x
    if (x + w > maxX) maxX = x + w
  })

  return maxX - minX
}

/**
 * Gets a generated node's local id, `macronode_<n>_iter_<i>`, the first not taken, and takes it.
 *
 * @param {number} i - The iteration.
 * @param {Set<string>} idSet - Local ids taken in the scope.
 * @returns {string}
 */
function getId(i, idSet) {
  let num = 1
  while (true) {
    const candidateId = `macronode_${num}_iter_${i}`
    if (!idSet.has(candidateId)) {
      idSet.add(candidateId)
      return candidateId
    }
    num++
  }
}

export function useMacroGenerator() {
  const { addNodes, addEdges, getNodes } = useVueFlow(FLOW_IDS.MAIN)
  const { scope, nodes: canvasNodes } = useActiveCanvas()

  /**
   * @param {Object} macroData - { flow: { nodes, edges, ... }, repeatCount: Number }
   * @param {Object} insertPosition - { x, y } where the first macro starts (e.g. center of screen)
   */
  const processMacroGeneration = (macroData, insertPosition = { x: 0, y: 0 }) => {
    const { flow, repeatCount } = macroData
    const sourceNodes = flow.nodes || []
    const sourceEdges = flow.edges || []

    if (sourceNodes.length === 0) return

    const realNodes = sourceNodes.filter((n) => n.type !== GHOST_NODE_TYPE)
    const ghostNodes = sourceNodes.filter((n) => n.type === GHOST_NODE_TYPE)

    const MACRO_WIDTH = getGraphWidth(sourceNodes)
    const MARGIN_X = 100 // Gap between iterations

    // We prepare arrays to batch-add everything at the end for performance
    const internalEdges = []
    const chainingEdges = [] // Edges connected to a ghost.

    sourceEdges.forEach((edge) => {
      const isTargetGhost = ghostNodes.find((g) => g.id === edge.target)
      if (isTargetGhost) {
        chainingEdges.push({
          ...edge,
          targetGhostId: edge.target, // Keep track of which ghost it hit.
        })
      } else {
        internalEdges.push(edge)
      }
    })

    const newNodes = []
    const newEdges = []

    // The macro goes in the scope shown, its ids that scope's (see utils/hierarchy nextNodeId).
    const into = scope.value
    const idSet = new Set() // Local ids taken in the scope.
    const namesSet = new Set()
    canvasNodes.value.forEach((node) => namesSet.add(node.data.name))
    getNodes.value.forEach((node) => {
      if (scopeOf(node) === into && localIdOf(node).startsWith('macronode_')) {
        idSet.add(localIdOf(node))
      }
    })

    const createdInstances = []
    for (let i = 0; i < repeatCount; i++) {
      const idMap = new Map() // Maps "Old ID" -> "New Unique ID" for this iteration.

      // Process nodes.
      realNodes.forEach((node) => {
        // Generate a unique ID.
        const localId = getId(i, idSet)
        const newId = nodeIdOf(into, localId)
        idMap.set(node.id, newId)

        // Calculate shift.
        const xOffset = i * (MACRO_WIDTH + MARGIN_X)

        // Inside a super-module, names keep its rules (see utils/hierarchy localNameProblem).
        const finalName = generateUniqueInstanceName(into ? toLocalName(node.data.name) : node.data.name, namesSet)
        namesSet.add(finalName)

        newNodes.push({
          id: newId,
          data: {
            ...node.data,
            name: finalName,
            scope: into,
            localId,
          },
          type: node.type,
          position: {
            // Relocate relative to the insertion point.
            x: insertPosition.x + node.position.x + xOffset - (repeatCount * MACRO_WIDTH) / 2,
            y: insertPosition.y + node.position.y,
          },
          selected: true,
        })
      })

      createdInstances.push(idMap)

      internalEdges.forEach((edge) => {
        const newSource = idMap.get(edge.source)
        const newTarget = idMap.get(edge.target)

        // Only add edge if both source/target exist in this iteration.
        if (newSource && newTarget) {
          newEdges.push({
            ...edge,
            id: `edge_${newSource}_to_${newTarget}`,
            source: newSource,
            target: newTarget,
            selected: false,
          })
        }
      })
      if (i > 0) {
        const prevInstanceMap = createdInstances[i - 1]
        const currentInstanceMap = createdInstances[i]

        chainingEdges.forEach((chainEdge) => {
          // Find the Ghost Node this edge was pointing to.
          const ghostNode = ghostNodes.find((g) => g.id === chainEdge.targetGhostId)

          // Find who the Ghost was mimicking (e.g., Node A).
          const originalTargetId = ghostNode.data.targetNodeId

          // Connect:
          // Source: The node from Previous Iteration
          // Target: The node from Current Iteration (the one the Ghost mimicked)
          newEdges.push({
            id: `chain_${i}_${crypto.randomUUID()}`,
            source: prevInstanceMap.get(chainEdge.source), // Source from Prev
            sourceHandle: chainEdge.sourceHandle,
            target: currentInstanceMap.get(originalTargetId), // Target from Curr
            targetHandle: chainEdge.targetHandle,
          })
        })
      }
    }

    // Batch add nodes and edges to the Main Flow.
    addNodes(newNodes)
    addEdges(newEdges)
  }

  return { processMacroGeneration }
}
