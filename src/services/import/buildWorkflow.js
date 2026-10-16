import { getHandleId, buildHandles, buildGhostHandles } from '../../utils/handles'
import { MAIN_NODE_TYPE, SOURCE_HANDLE_TYPE, TARGET_HANDLE_TYPE } from '../../utils/constants'
import { resolvePortCouplings, checkAndClaimCouplings } from '../../utils/edges'
import { getId as getNextNodeId } from '../../utils/nodes'
import { getPortVariables, reconcileRows } from '../math/reconcileRows'
import { isBlank } from '../../utils/variables'

/**
 * Builds an instance's variables from its math analysis, keeping the module's configured values
 * and filling the rest from the values taken out of its math.
 *
 * @param {Object} moduleData
 * @param {Object|null} mathAnalysis
 * @param {Map<string, string>} mathDefaults - From libraryStore.getMathDefaults.
 * @returns {Array} Parameter rows.
 */
function resolveInstanceVariables(moduleData, mathAnalysis, mathDefaults) {
  // A module's blank value means none was configured, so the math's default should fill it.
  const templateRows = (moduleData.variables ?? []).map((variable) =>
    isBlank(variable.value) ? { ...variable, value: null } : variable
  )
  if (mathAnalysis) {
    return reconcileRows(mathAnalysis, templateRows, {
      portVariables: getPortVariables(moduleData.ports),
      defaults: mathDefaults,
    })
  }
  return templateRows.map((variable) => ({
    ...variable,
    value: variable.value ?? mathDefaults.get(variable.name) ?? null,
  }))
}

export function buildInstance(
  nodeId,
  name,
  nodeType,
  moduleData,
  handles,
  position = null,
  mathAnalysis = null,
  mathDefaults = new Map()
) {
  const conditionalProperties = position 
    ? { position } 
    : { position: { x: 100, y: 100 }, style: { opacity: 0 } }

  return {
    id: nodeId,
    type: nodeType,
    ...conditionalProperties, 
    data: {
      name,
      mathRef: moduleData.mathRef,
      moduleRef: moduleData.moduleRef,
      variables: resolveInstanceVariables(moduleData, mathAnalysis, mathDefaults),
      ports: moduleData.ports,
      handles,
    },
  }
}

function buildInstances(instanceRefs, availableModules, getMathAnalysis, currentNodes, progressCallback, getMathDefaults) {
  const pendingInstances = []
  let nodeId = getNextNodeId(currentNodes.map((n) => n.id))

  instanceRefs.forEach((instanceRef, index) => {
    if (progressCallback) {
      progressCallback(index, instanceRefs.length, instanceRef.name)
    }

    const module = availableModules.get(`${instanceRef.module_type}:${instanceRef.module_subtype}`)
    if (!module) {
      console.warn(
        `No config found for module "${instanceRef.name}" ` +
          `(module_type: ${instanceRef.module_type}, module_subtype: ${instanceRef.module_subtype})`
      )
    }

    if (progressCallback && index === instanceRefs.length) {
      progressCallback(instanceRefs.length, instanceRefs.length, 'Building connections...')
    }

    const nodeType = MAIN_NODE_TYPE
    const ghostHandles = buildGhostHandles()
    const handles = buildHandles(instanceRef, ghostHandles)
    
    let position = null
    if (instanceRef.x !== undefined && instanceRef.y !== undefined) {
      position = { x: instanceRef.x, y: instanceRef.y }
    }

    const mathAnalysis = module ? getMathAnalysis?.(module.mathRef) ?? null : null
    const mathDefaults = (module && getMathDefaults?.(module.mathRef)) ?? new Map()
    pendingInstances.push(
      buildInstance(nodeId, instanceRef.name, nodeType, module, handles, position, mathAnalysis, mathDefaults)
    )

    nodeId = getNextNodeId([nodeId])
  })

  return pendingInstances
}

/**
 * Builds the conduit edges of the instances' out_instances, in module-array order as circulatory_autogen connects
 * them, so each takes the first slot no earlier edge holds.
 *
 * @param {Array} instanceRefs - The module array rows.
 * @param {Array} pendingInstances - The nodes built from them.
 * @returns {{ edges: Array, conflicts: Array<string> }} The edges, and a message for each conduit rejected as a port
 *   it needs has no free slot.
 */
function buildEdges(instanceRefs, pendingInstances) {

  const pendingEdges = []
  const conflicts = []

  const nodeMap = new Map(pendingInstances.map((n) => [n.data.name, n]))

  // Tracks consumed single-connection port slots across all edges built so far.
  // Populated via checkAndClaimCouplings; see edges.js for key format.
  const usedPortKeys = new Set()

  instanceRefs.forEach((instanceRef) => {

    if (!instanceRef.out_instances) return

    const sourceNode = nodeMap.get(instanceRef.name)

    if (!sourceNode || sourceNode.data.error) return

    const targets = instanceRef.out_instances.split(' ').filter((t) => t.trim())
    targets.forEach((targetName) => {
      const targetNode = nodeMap.get(targetName)
      if (!targetNode || targetNode.data.error) return

      const sourceHandle = sourceNode.data.handles.find(
        (p) => p.type === SOURCE_HANDLE_TYPE && p.name === targetName
      )

      const targetHandle = targetNode.data.handles.find(
        (p) => p.type === TARGET_HANDLE_TYPE && p.name === instanceRef.name
      )

      if (!sourceHandle || !targetHandle) {
        console.warn(
          `[buildEdges] Could not find matching handles between "${instanceRef.name}" and "${targetName}" — skipping.`
        )
        return
      }

      // Each repeated label takes its first slot that no earlier edge holds.
      const couplings = resolvePortCouplings(sourceNode.data.ports ?? [], targetNode.data.ports ?? [], {
        sourceId: instanceRef.name,
        targetId: targetName,
        usedPortKeys,
      })

      if (couplings.length === 0) {
        console.warn(
          `[buildEdges] No compatible port label matches between "${instanceRef.name}" and "${targetName}" — conduit edge skipped.`
        )
        return
      }

      // Enforce the non-multiport single-connection constraint.
      // All-or-nothing: if any coupling has no free slot, the whole conduit is rejected.
      const { valid, conflicts: found } = checkAndClaimCouplings(
        instanceRef.name,
        targetName,
        couplings,
        usedPortKeys
      )

      if (!valid) {
        conflicts.push(`${instanceRef.name} → ${targetName}: ${found.join(' ')}`)
        return
      }

      pendingEdges.push({
        id: `${sourceNode.id}--${targetNode.id}`,
        source: sourceNode.id,
        target: targetNode.id,
        sourceHandle: getHandleId(sourceHandle),
        targetHandle: getHandleId(targetHandle),
        data: {
          couplings,
        },
      })
    })
  })

  return { edges: pendingEdges, conflicts }
}

/**
 * Builds the nodes and conduit edges of a module array.
 *
 * @param {Array} instanceRefs - The module array rows.
 * @param {Map<string, Object>} availableModules - Library modules by `module_type:module_subtype`.
 * @param {Function} getMathAnalysis - From libraryStore.
 * @param {Array} currentNodes - The nodes already on the canvas, for fresh ids.
 * @param {Function|null} [progressCallback]
 * @param {Function|null} [getMathDefaults] - From libraryStore.
 * @returns {{ pendingInstances: Array, pendingEdges: Array, conflicts: Array<string> }} conflicts: a message for each
 *   conduit left out as a port it needs has no free slot.
 */
export function buildWorkflowGraph(
  instanceRefs,
  availableModules,
  getMathAnalysis,
  currentNodes,
  progressCallback = null,
  getMathDefaults = null
) {
  const pendingInstances = buildInstances(
    instanceRefs,
    availableModules,
    getMathAnalysis,
    currentNodes,
    progressCallback,
    getMathDefaults
  )
  const { edges: pendingEdges, conflicts } = buildEdges(instanceRefs, pendingInstances)
  return { pendingInstances, pendingEdges, conflicts }
}
