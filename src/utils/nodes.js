import { useVueFlow } from "@vue-flow/core"
import { FLOW_IDS } from "./constants"
import { nextSequentialId } from "./hierarchy"

const { getNodes } = useVueFlow(FLOW_IDS.MAIN)

/**
 * Generates a unique instance name based on the instance data and existing names.
 *
 * @param {*} instanceData - The instance to generate a unqiue name for.
 * @param {*} existingNames - A set of existing names to check against.
 * @returns {string} A unique instance name.
 */
export function generateUniqueInstanceName(currentName, existingNames) {
  let finalName = currentName
  let counter = 1

  while (existingNames.has(finalName)) {
    finalName = `${currentName}_${counter}`
    counter++
  }

  return finalName
}

/**
 * Generates a unique node ID for drag-and-drop nodes.
 *
 * @returns {string} Unique node ID.
 */
export function getId(nodeIds, prefix = 'dndnode_') {
  return nextSequentialId(nodeIds, prefix)
}

export function findAnyNode() {
  return getNodes.value.find(n => n.data?.layoutFrame)
}

/**
 * Puts new modules in the same reference frame if user imported using instance array
 * containing x and y (z ignored for now).
 */
export function attachNewNodeToFrame(position, existingNodeData) {
  const frame = existingNodeData?.layoutFrame
  if (!frame) return null

  const refX = position.x / frame.xScale + frame.xCentre
  const refY = position.y / frame.yScale + frame.yCentre

  return {
    layoutFrame: frame,
    layoutRef: { refX, refY }
  }
}
