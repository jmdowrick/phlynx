/**
 * The workspace's super-modules: each one's name and subsystems, what it may be placed in, and the nodes it holds,
 * read from the store whatever scope the canvas shows; and the commands that add subsystems to the canvas. The
 * palette, the breadcrumb and subsystem nodes read it.
 */
import { computed, effectScope } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import { useActiveCanvas } from './useActiveCanvas'
import { useFlowHistoryFor } from './useFlowHistoryFor'
import { indexExposures, nextExposedPortId, portResolver, subsystemPorts } from '../services/hierarchy/exposure'
import { supermoduleContentHash } from '../services/hierarchy/operations'
import { buildSubsystem, buildSupermoduleInterface } from '../services/import/buildWorkflow'
import { importCaModuleArray, templateHash } from '../services/import/caFold'
import { layoutSupermoduleScopes } from '../services/layouts/scopes'
import { useLibraryStore } from '../stores/libraryStore'
import { FLOW_IDS } from '../utils/constants'
import {
  canPlaceSubsystem,
  isSubsystem,
  isSupermoduleInterface,
  localNameProblem,
  nextSupermoduleId,
  scopeOf,
  supermoduleDependencies,
  supermoduleOccurrences,
} from '../utils/hierarchy'

// A flow without nodes, such as a stub of one, reads as empty.
const NONE = Object.freeze({ value: Object.freeze([]) })

// Each flow's super-modules, shared by every caller.
const catalogues = new WeakMap()

/**
 * @typedef {Object} SupermoduleEntry
 * @property {string} id
 * @property {string} name
 * @property {string} label - Its circulatory_autogen `module_type:module_subtype` once it has one, else its name.
 * @property {Object|null} source - The library definition it was made from, if any.
 * @property {number} count - Its subsystems, as the palette shows.
 * @property {number} occurrences - Its copies in the model, through super-modules holding it: what an edit changes.
 */

/**
 * Gives a flow's super-modules.
 *
 * @param {string} [flowId=FLOW_IDS.MAIN]
 * @returns {ReturnType<typeof createCatalogue>} `supermodules` holds a SupermoduleEntry for each.
 */
export function useSupermodules(flowId = FLOW_IDS.MAIN) {
  const flow = useVueFlow(flowId)
  // Outside any component, so no component's unmounting stops it for the others.
  if (!catalogues.has(flow)) catalogues.set(flow, effectScope(true).run(() => createCatalogue(flow, flowId)))
  return catalogues.get(flow)
}

/**
 * Builds a flow's super-modules.
 *
 * @param {Object} flow - From useVueFlow.
 * @param {string} flowId
 */
function createCatalogue(flow, flowId) {
  // Read when used, so a flow's nodes are found however it holds them.
  const allNodes = () => (flow.nodes ?? flow.getNodes ?? NONE).value
  const allEdges = () => (flow.edges ?? flow.getEdges ?? NONE).value
  const canvas = useActiveCanvas(flowId)

  const supermodules = computed(() => {
    const nodes = allNodes()
    const counts = new Map()
    for (const node of nodes) if (isSubsystem(node)) counts.set(node.data?.smId, (counts.get(node.data?.smId) ?? 0) + 1)
    const occurrences = supermoduleOccurrences(nodes)
    return nodes.filter(isSupermoduleInterface).map((node) => {
      const { name = node.id, ca = null, source = null } = node.data?.supermodule ?? {}
      return {
        id: node.id,
        name,
        label: ca ? `${ca.module_type}:${ca.module_subtype}` : name,
        source,
        count: counts.get(node.id) ?? 0,
        occurrences: occurrences.get(node.id) ?? 0,
      }
    })
  })
  const byId = computed(() => new Map(supermodules.value.map((entry) => [entry.id, entry])))
  const dependencies = computed(() => supermoduleDependencies(allNodes()))
  // Every super-module's exposed ports, from its exposure edges.
  const exposures = computed(() => indexExposures(allNodes(), allEdges()))

  /** @returns {Object|undefined} A super-module's entry. */
  const find = (smId) => byId.value.get(smId)

  // Each super-module made from a circulatory_autogen library template: the template, and whether it still matches,
  // by what it holds as it was made, and by the template the library has now, when it has it.
  const templates = computed(() => {
    const nodes = allNodes()
    const edges = allEdges()
    const library = useLibraryStore().availableSupermodules
    const result = new Map()
    for (const node of nodes) {
      const { source, ca } = (isSupermoduleInterface(node) && node.data?.supermodule) || {}
      if (source?.format !== 'circulatory_autogen') continue
      const changed = !!source.contentHash && supermoduleContentHash(node.id, nodes, edges) !== source.contentHash
      const replaced = library.has(source.moduleRef) && templateHash(source.moduleRef, library) !== source.hash
      result.set(node.id, { label: ca ? `${ca.module_type}:${ca.module_subtype}` : source.moduleRef, matches: !changed && !replaced })
    }
    return result
  })

  /**
   * Gets the library template a super-module was made from, and whether it still matches it.
   *
   * @param {string} smId
   * @returns {{label: string, matches: boolean}|undefined} Undefined when it wasn't made from one.
   */
  const templateOf = (smId) => templates.value.get(smId)

  /** @returns {number} How many subsystems a super-module has, nested ones included. */
  const countOf = (smId) => find(smId)?.count ?? 0

  /**
   * Whether a subsystem of a super-module can be placed in a scope: the super-module exists, and placing it there
   * makes no cycle (see utils/hierarchy canPlaceSubsystem).
   *
   * @param {string|null} scope
   * @param {string} smId
   * @returns {boolean}
   */
  const canPlace = (scope, smId) => !!find(smId) && canPlaceSubsystem(dependencies.value, scope, smId)

  /** @returns {Array} The ports a new subsystem of a super-module has (see subsystemPorts). */
  const portsOf = (smId) => subsystemPorts(allNodes(), allEdges(), smId, exposures.value)

  /**
   * Gets a super-module's exposed ports, in order, as its exposure edges give them (see exposure.js indexExposures).
   *
   * @param {string} smId
   * @returns {Array<Object>} ExposedPorts: `{id, alias, label?, order, edgeId, childId}`.
   */
  const exposedPortsOf = (smId) => exposures.value.get(smId) ?? []

  /** @returns {string[]} The ids of a super-module's nodes: its interface node and every node in its scope. */
  const memberIdsOf = (smId) =>
    allNodes()
      .filter((node) => node.id === smId || scopeOf(node) === smId)
      .map((node) => node.id)

  /**
   * Gets the super-modules a removal leaves without subsystems: every subsystem of each is among those removed, and
   * the super-module itself isn't.
   *
   * @param {Iterable<string>} removedIds
   * @returns {string[]}
   */
  const orphanedBy = (removedIds) => {
    const removed = new Set(removedIds)
    const nodes = allNodes()
    const kept = nodes.filter((node) => isSubsystem(node) && !removed.has(node.id))
    const smIds = new Set(nodes.filter((node) => removed.has(node.id) && isSubsystem(node)).map((node) => node.data.smId))
    return [...smIds].filter((smId) => find(smId) && !removed.has(smId) && !kept.some((node) => node.data.smId === smId))
  }

  /**
   * Gets the exposed ports a removal un-exposes: those of each removed node inside a super-module, and those of each
   * removed exposure edge.
   *
   * @param {Iterable<string>} removedIds - Node ids.
   * @param {Iterable<string>} [removedEdgeIds=[]]
   * @returns {{smId: string, exposedPortId: string, nodeName: string, portLabel: string}[]}
   */
  const exposedBy = (removedIds, removedEdgeIds = []) => {
    const removed = new Set(removedIds)
    const removedEdges = new Set(removedEdgeIds)
    const nodeById = new Map(allNodes().map((node) => [node.id, node]))
    const resolve = portResolver(allNodes(), exposures.value)
    return [...exposures.value].flatMap(([smId, exposed]) =>
      exposed
        .filter((port) => removed.has(port.childId) || removedEdges.has(port.edgeId))
        .map((port) => ({
          smId,
          exposedPortId: port.id,
          nodeName: nodeById.get(port.childId)?.data?.name ?? port.childId,
          portLabel: resolve(smId, port.id)?.label ?? port.label ?? port.alias.label ?? port.id,
        }))
    )
  }

  /**
   * Removes a super-module and every node in it as the canvas removes nodes, so the removal is recorded. Its interface
   * node can't be deleted from the canvas, so it is removed here as one that can.
   *
   * @param {string} smId
   */
  const deleteSupermodule = (smId) => {
    const ids = memberIdsOf(smId)
    flow.removeNodes(
      ids.map((id) => {
        const node = flow.findNode(id)
        return node?.deletable === false ? { ...node, deletable: true } : id
      })
    )
  }

  /**
   * Why a name can't be a new subsystem's on the canvas, or null when it can: the rules for names inside super-modules
   * (see localNameProblem), and unique on the canvas.
   *
   * @param {string} name
   * @returns {string|null}
   */
  const subsystemNameProblem = (name) => {
    const trimmed = (name ?? '').trim()
    const problem = localNameProblem(trimmed, { scope: canvas.scope.value, subsystem: true })
    if (problem) return problem
    if (canvas.nodes.value.some((node) => node.data?.name === trimmed)) return `"${trimmed}" is already used here.`
    return null
  }

  /**
   * Why a name can't be a super-module's, or null when it can: a subsystem's rules, and unique among super-modules.
   *
   * @param {string} name
   * @param {Object} [options]
   * @param {string} [options.except] - The super-module being renamed, whose own name doesn't count.
   * @returns {string|null}
   */
  const supermoduleNameProblem = (name, { except } = {}) => {
    const trimmed = (name ?? '').trim()
    const problem = localNameProblem(trimmed, { subsystem: true })
    if (problem) return problem
    const taken = supermodules.value.some((entry) => entry.name === trimmed && entry.id !== except)
    return taken ? `A super-module is already called "${trimmed}".` : null
  }

  /**
   * Renames a super-module, as one undo step. Its subsystems keep their own names.
   *
   * @param {string} smId
   * @param {string} name - Checked by supermoduleNameProblem.
   * @param {Object} [options]
   * @param {Object} [options.history] - The undo stack to record into; the workspace's by default.
   * @returns {Promise<boolean>} Whether the name changed.
   * @throws {Error} When the name can't be used.
   */
  async function renameSupermodule(smId, name, { history = useFlowHistoryFor() } = {}) {
    const trimmed = (name ?? '').trim()
    const node = flow.findNode(smId)
    if (!isSupermoduleInterface(node) || node.data?.supermodule?.name === trimmed) return false
    const problem = supermoduleNameProblem(trimmed, { except: smId })
    if (problem) throw new Error(problem)
    const before = JSON.parse(JSON.stringify(node.data.supermodule))
    const write = (supermodule) => {
      const target = flow.findNode(smId)
      if (target) target.data = { ...target.data, supermodule: { ...supermodule } }
    }
    await history.executeAndAddCommand({
      type: 'rename-supermodule',
      redo: () => write({ ...before, name: trimmed }),
      undo: () => write(before),
    })
    return true
  }

  /** @returns {string} A name a new super-module and its subsystem can both have: `base`, else `base_2`, `base_3`, … */
  const freeSupermoduleName = (base = 'supermodule') => {
    let name = base
    for (let n = 2; subsystemNameProblem(name) || supermoduleNameProblem(name); n++) name = `${base}_${n}`
    return name
  }

  /** @returns {string} A name not yet used on the canvas: `base`, else `base_2`, `base_3`, … */
  const freeName = (base) => {
    const taken = new Set(canvas.nodes.value.map((node) => node.data?.name))
    let name = base
    for (let n = 2; taken.has(name); n++) name = `${base}_${n}`
    return name
  }

  /**
   * Makes a new, empty super-module and one subsystem of it on the canvas, both named `name`, as one undo step. Both
   * get the usual ghost handles, where edges attach.
   *
   * @param {string} name - Checked by subsystemNameProblem and supermoduleNameProblem.
   * @param {{x: number, y: number}} position - Where the subsystem goes, in flow coordinates.
   * @param {Object} [options]
   * @param {Object} [options.history] - The undo stack to record into; the workspace's by default.
   * @returns {{smId: string, subsystemId: string}}
   * @throws {Error} When the name can't be used.
   */
  function createEmptySubsystem(name, position, { history = useFlowHistoryFor() } = {}) {
    const trimmed = (name ?? '').trim()
    const problem = subsystemNameProblem(trimmed) ?? supermoduleNameProblem(trimmed)
    if (problem) throw new Error(problem)

    const smId = nextSupermoduleId(allNodes())
    const subsystemId = canvas.nextNodeId()
    const nodes = [
      buildSupermoduleInterface(smId, { name: trimmed }),
      buildSubsystem(subsystemId, trimmed, smId, { scope: canvas.scope.value, position }),
    ]
    history.startBatch()
    try {
      flow.addNodes(nodes)
    } finally {
      history.endBatch()
    }
    return { smId, subsystemId }
  }

  /**
   * Places another subsystem of a super-module on the canvas, named after it and unique there, with its ports.
   *
   * @param {string} smId
   * @param {{x: number, y: number}} position - In flow coordinates.
   * @returns {string|null} The new subsystem's id, or null when it can't be placed here (see canPlace).
   */
  function addSubsystem(smId, position) {
    if (!canPlace(canvas.scope.value, smId)) return null
    const id = canvas.nextNodeId()
    const options = { scope: canvas.scope.value, ports: portsOf(smId), position }
    flow.addNodes(buildSubsystem(id, freeName(find(smId).name), smId, options))
    return id
  }

  // The library's circulatory_autogen super-modules, which the palette places as workspace super-modules.
  const librarySupermodules = computed(() =>
    [...useLibraryStore().availableSupermodules.values()].map((template) => ({
      moduleRef: template.moduleRef,
      name: template.module_type,
      description: template.description ?? template.moduleRef,
    }))
  )

  /**
   * Places a subsystem of a library super-module, as one undo step: of the workspace super-module made from it when
   * there is one, made from the same definition (its moduleRef and content hash); else of a new one, built as a module
   * array of one instance of it is (see caFold.importCaModuleArray), with every super-module nested in it. It exposes
   * nothing until the user exposes ports. Global constants its parameterisation sets are added when not set already.
   *
   * @param {string} moduleRef
   * @param {{x: number, y: number}} position - In flow coordinates.
   * @param {Object} [options]
   * @param {Object} [options.history] - The undo stack to record into; the workspace's by default.
   * @returns {Promise<string|null>} The new subsystem's id, or null when it can't be placed here.
   */
  async function placeLibrarySupermodule(moduleRef, position, { history = useFlowHistoryFor() } = {}) {
    const library = useLibraryStore()
    const template = library.availableSupermodules.get(moduleRef)
    if (!template) return null
    const hash = templateHash(moduleRef, library.availableSupermodules)
    const made = allNodes().find((node) => {
      const source = isSupermoduleInterface(node) ? node.data?.supermodule?.source : null
      return source?.moduleRef === moduleRef && source.hash === hash && !source.fork
    })
    if (made) return addSubsystem(made.id, position)

    const { module_type, module_subtype } = template
    const built = importCaModuleArray(
      [{ name: module_type, module_type, module_subtype, inp_instances: [], out_instances: [] }],
      {
        supermodules: library.availableSupermodules,
        modules: library.availableModules,
        getMathAnalysis: library.getMathAnalysis,
        getMathDefaults: library.getMathDefaults,
      },
      { source: moduleRef, load: library.caParameterLoader(), currentNodes: allNodes(), nextExposedPortId: nextExposedPortId(allNodes(), allEdges()) }
    )
    const instance = built.nodes.find((node) => !node.hidden)
    const nodes = built.nodes.filter((node) => node.hidden)
    await layoutSupermoduleScopes(nodes, built.edges)
    for (const { name, value, units, data_reference } of built.globals) {
      if (!library.getGlobalConstant(name)) library.assignGlobalConstant(name, value, units, data_reference)
    }
    history.startBatch()
    try {
      flow.addNodes(nodes)
      flow.addEdges(built.edges)
      return addSubsystem(instance.data.smId, position)
    } finally {
      history.endBatch()
    }
  }

  return {
    supermodules,
    librarySupermodules,
    placeLibrarySupermodule,
    find,
    templateOf,
    countOf,
    canPlace,
    portsOf,
    exposedPortsOf,
    memberIdsOf,
    orphanedBy,
    exposedBy,
    deleteSupermodule,
    renameSupermodule,
    subsystemNameProblem,
    supermoduleNameProblem,
    createEmptySubsystem,
    freeSupermoduleName,
    addSubsystem,
  }
}
