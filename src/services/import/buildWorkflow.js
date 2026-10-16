import { getHandleId, buildHandles, buildGhostHandles } from '../../utils/handles'
import {
  MAIN_NODE_TYPE,
  SOURCE_HANDLE_TYPE,
  SUPER_INSTANCE_NODE_TYPE,
  SUPERMODULE_INTERFACE_NODE_TYPE,
  TARGET_HANDLE_TYPE,
} from '../../utils/constants'
import { assertNodeId, splitNodeId } from '../../utils/hierarchy'
import { resolvePortCouplings, checkAndClaimCouplings } from '../../utils/edges'
import { getId as getNextNodeId } from '../../utils/nodes'
import { getPortVariables, reconcileRows } from '../math/reconcileRows'
import { isBlank } from '../../utils/variables'
import { caHeartInputs, HEART_IVC_FLOW, heartSlotPin, instanceNames, isHeart } from '../caRules'
import { foldVariantNodes } from '../caVariants'

/**
 * Builds an instance's variables from its math analysis, keeping the module's configured values
 * and filling the rest from the values taken out of its math.
 *
 * @param {Object} moduleData
 * @param {Object|null} mathAnalysis
 * @param {Map<string, string>} mathDefaults - From libraryStore.getMathDefaults.
 * @returns {Array} Parameter rows.
 */
export function resolveInstanceVariables(moduleData, mathAnalysis, mathDefaults) {
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

/**
 * Builds a super instance: one instance of a super-module, standing in its scope like a module.
 *
 * @param {string} nodeId - From nextNodeId(scope): `<scope>~<localId>` inside a super-module.
 * @param {string} name - Its local name, which prefixes its children's flat names.
 * @param {string} smId - Its super-module's id.
 * @param {Object} [options]
 * @param {string|null} [options.scope=null] - The super-module it is a child of; null at the root.
 * @param {Array} [options.ports=[]] - Its ports, each a copy of the child port an exposed port aliases with its
 *   exposedPortId and label (see superInstancePorts), kept in step with its super-module (see useSuperInstanceSync).
 * @param {Array} [options.handles] - Where its edges attach; a fresh set of ghosts by default.
 * @param {Object} [options.overrides={}] - Values set on this instance: `{ <localId path>: { <variable>: { value } } }`,
 *   paths of local ids below it joined with '/'. Local constants (H13) are kept under '@' for its own super-module's
 *   and `<localId path>/@` for a nested super instance's.
 * @param {Object|null} [options.position=null]
 * @returns {Object}
 * @throws {Error} When nodeId is not in scope (see assertNodeId).
 */
export function buildSuperInstance(nodeId, name, smId, { scope = null, ports = [], handles = buildGhostHandles(), overrides = {}, position = null } = {}) {
  const node = {
    id: nodeId,
    type: SUPER_INSTANCE_NODE_TYPE,
    position: position ?? { x: 100, y: 100 },
    data: {
      scope,
      localId: scope ? splitNodeId(nodeId).localId : nodeId,
      name,
      smId,
      overrides,
      ports,
      handles,
    },
  }
  assertNodeId(node)
  return node
}

/**
 * Builds a super-module's interface node, which holds its definition and is the only record of it. It lives in the
 * super-module's own scope, its id the super-module's, and can't be deleted from the canvas. What it exposes is drawn
 * as exposure edges from its children to it (see services/hierarchy/exposure.js), never stored here.
 *
 * @param {string} smId - From nextSupermoduleId.
 * @param {Object} supermodule
 * @param {string} supermodule.name
 * @param {{module_type: string, module_subtype: string}|null} [supermodule.ca=null] - Its circulatory_autogen
 *   identity, once it has one.
 * @param {string[]} [supermodule.submoduleOrder=[]] - Its children's local ids, in expansion and CA submodule order.
 * @param {Array} [supermodule.localConstants=[]] - Constants its top-level children share, `{name, units, value,
 *   data_reference}`; an instance overrides them under '@', an outer one under `<localId path>/@`.
 * @param {'prefixed'|'preserve'} [supermodule.naming='prefixed'] - Whether its children's flat names are prefixed
 *   with the instance's, or keep their own (for a CellML encapsulation import with one instance).
 * @param {Object|null} [supermodule.source=null] - Where it came from, for CA or CellML import.
 * @param {Object|null} [position=null]
 * @param {Object} [options]
 * @param {Array} [options.handles] - Where exposure edges attach; they carry no port. A fresh set of ghosts by
 *   default.
 * @returns {Object}
 * @throws {Error} When smId breaks the id rules (see assertNodeId).
 */
export function buildSupermoduleInterface(
  smId,
  { name, ca = null, submoduleOrder = [], localConstants = [], naming = 'prefixed', source = null },
  position = null,
  { handles = buildGhostHandles() } = {}
) {
  const node = {
    id: smId,
    type: SUPERMODULE_INTERFACE_NODE_TYPE,
    deletable: false,
    position: position ?? { x: 0, y: 0 },
    data: {
      scope: smId,
      localId: smId,
      supermodule: { name, ca, submoduleOrder, localConstants, naming, source },
      handles,
    },
  }
  assertNodeId(node)
  return node
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
 * them, so each takes the first slot no earlier edge holds. With CA's rules, an edge into a heart takes the entrance
 * vessel_port slot CA gives it by its place in the heart's inp_instances (see heartEntranceSlot), kept on the coupling
 * as its targetSlot.
 *
 * @param {Array} instanceRefs - The module array rows.
 * @param {Array} pendingInstances - The nodes built from them.
 * @param {boolean} [caRules=false] - Whether the rows are a CA module array.
 * @returns {{ edges: Array, conflicts: Array<string> }} The edges, and a message for each conduit rejected as a port
 *   it needs has no free slot.
 */
function buildEdges(instanceRefs, pendingInstances, caRules = false) {

  const pendingEdges = []
  const conflicts = []

  const nodeMap = new Map(pendingInstances.map((n) => [n.data.name, n]))
  const refMap = new Map(instanceRefs.map((ref) => [ref.name, ref]))

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

      // Each repeated label takes its first slot that no earlier edge holds, but a heart's input the slot CA gives it.
      const couplings = resolvePortCouplings(sourceNode.data.ports ?? [], targetNode.data.ports ?? [], {
        sourceId: instanceRef.name,
        targetId: targetName,
        usedPortKeys,
        stored: caRules ? heartPin(refMap.get(targetName), targetNode, instanceRef.name) : [],
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
 * Lists a heart row's inputs as CA wires them (see caHeartInputs).
 *
 * @param {Object} ref - A module array row.
 * @returns {string[]|null} Null when the row is no heart.
 */
function heartInputsOf(ref) {
  if (!ref || !isHeart(ref.module_type ?? '')) return null
  return caHeartInputs(instanceNames(ref.inp_instances), instanceNames(ref.out_instances).length)
}

/**
 * Gets the coupling that pins an input to the heart entrance slot CA gives it (see heartSlotPin).
 *
 * @param {Object|undefined} targetRef - The target's module array row.
 * @param {Object} targetNode
 * @param {string} sourceName
 * @returns {Array} The pinning coupling, or none when the target is no heart or the source not among its inputs.
 */
function heartPin(targetRef, targetNode, sourceName) {
  const inputs = heartInputsOf(targetRef)
  return inputs ? heartSlotPin(targetNode.data.ports, inputs, sourceName) : []
}

/**
 * Sets the ivc flow of each heart with two inputs to 0, as CA feeds it from zero_flow; an unconnected boundary
 * condition takes its own value.
 *
 * @param {Array} instanceRefs - The module array rows.
 * @param {Array} pendingInstances - The nodes built from them, in the same order.
 * @returns {string[]} The names of the hearts zeroed.
 */
function zeroHeartIvcFlow(instanceRefs, pendingInstances) {
  const hearts = []
  instanceRefs.forEach((ref, index) => {
    if (heartInputsOf(ref)?.length !== 2) return
    const node = pendingInstances[index]
    node.data.variables = (node.data.variables ?? []).map((variable) =>
      variable.name === HEART_IVC_FLOW ? { ...variable, value: '0' } : variable
    )
    hearts.push(ref.name)
  })
  return hearts
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
 * @param {Object} [options]
 * @param {boolean} [options.caRules=false] - Applies circulatory_autogen's heart rule, for a CA module array: each
 *   input takes the heart slot of its place in inp_instances, and a heart with two inputs has no ivc flow.
 * @param {Map<string, Object>} [options.variants] - Per-instance variants of modules the CA export wrote (see
 *   libraryStore.caVariants), by ref: their rows are built from them, connected through their ports, then folded
 *   back onto the module each stands in for (see foldVariantNodes).
 * @returns {{ pendingInstances: Array, pendingEdges: Array, conflicts: Array<string>, ivcZeroedHearts: string[] }}
 *   conflicts: a message for each conduit left out as a port it needs has no free slot; ivcZeroedHearts: the hearts
 *   whose ivc flow CA's rule set to 0, which a parameters file must not set (see withoutZeroedIvcRows).
 */
export function buildWorkflowGraph(
  instanceRefs,
  availableModules,
  getMathAnalysis,
  currentNodes,
  progressCallback = null,
  getMathDefaults = null,
  { caRules = false, variants = null } = {}
) {
  const modules = variants?.size ? new Map([...availableModules, ...variants]) : availableModules
  const pendingInstances = buildInstances(
    instanceRefs,
    modules,
    getMathAnalysis,
    currentNodes,
    progressCallback,
    getMathDefaults
  )
  const ivcZeroedHearts = caRules ? zeroHeartIvcFlow(instanceRefs, pendingInstances) : []
  const { edges: pendingEdges, conflicts } = buildEdges(instanceRefs, pendingInstances, caRules)
  const built = instanceRefs.map((ref) => modules.get(`${ref.module_type}:${ref.module_subtype}`))
  foldVariantNodes(pendingInstances, pendingEdges, built)
  return { pendingInstances, pendingEdges, conflicts, ivcZeroedHearts }
}
