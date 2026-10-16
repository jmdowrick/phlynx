/**
 * Scoped models: a selection of instances, the couplings between them, and the inspection modules that
 * reach them, flattened on their own. The whole model is the scope of every node. The nodes and edges are the model's
 * (see useModelGraph), super instances expanded.
 */
import { resolveBoundaryValues } from '../export/boundaryValues'
import { errorsConcerning, summariseExpansionErrors } from '../hierarchy/errors'
import { generateFlattenedModel } from '../../utils/cellml'
import { cyrb53 } from '../../utils/misc'
import { couplingConflicts, variableTypes } from '../../utils/multiport'
import { getHandleId } from '../../utils/handles'
import { HANDLE_VARIANT } from '../../utils/constants'
import { indexByScope, isSuperInstance } from '../../utils/hierarchy'
import { isEmpty } from '../../utils/variables'

/**
 * Resolves a selection of nodes into a scope. Edges with both ends selected are kept; edges with one
 * end selected are cut. Inspection modules keep only their selected variables, and are left out when
 * none remain.
 *
 * @param {string[]|null} nodeIds - The selected node ids, or null for every node.
 * @param {Array<Object>} nodes - The model's nodes.
 * @param {Array<Object>} edges - The model's edges.
 * @param {Array<Object>} [inspectionModules] - Records from inspectionModuleStore.
 * @param {{modelErrors?: Array<Object>}} [options] - `modelErrors`: the problems expanding super instances found (see
 *   useModelGraph), of which the scope keeps those concerning it.
 * @returns {{nodeIds: string[], nodes: Array, internalEdges: Array, cutEdges: Array, inspectionModules: Array,
 *   trimmedModules: Array<{name: string, removed: number, isLeftOut: boolean}>, allNodes: Array, allEdges: Array,
 *   modelErrors: Array<Object>}}
 */
export function resolveScope(nodeIds, nodes, edges, inspectionModules = [], { modelErrors = [] } = {}) {
  const selected = new Set(nodeIds ?? nodes.map((node) => node.id))
  const scopeNodes = nodes.filter((node) => selected.has(node.id))
  const inScope = (id) => selected.has(id)

  const internalEdges = edges.filter((edge) => inScope(edge.source) && inScope(edge.target))
  const cutEdges = edges.filter((edge) => inScope(edge.source) !== inScope(edge.target))

  const scopedModules = []
  const trimmedModules = []
  for (const module of inspectionModules) {
    const variables = (module.variables ?? []).filter((entry) => inScope(entry.nodeId))
    const removed = (module.variables ?? []).length - variables.length
    if (removed) trimmedModules.push({ name: module.name, removed, isLeftOut: variables.length === 0 })
    if (variables.length) scopedModules.push({ ...module, variables })
  }

  const scopeNodeIds = scopeNodes.map((node) => node.id).sort()
  return {
    nodeIds: scopeNodeIds,
    nodes: scopeNodes,
    internalEdges,
    cutEdges,
    inspectionModules: scopedModules,
    trimmedModules,
    allNodes: nodes,
    allEdges: edges,
    modelErrors: errorsConcerning(modelErrors, scopeNodeIds),
  }
}

/**
 * Narrows a Vue Flow object (`toObject()`) to some nodes and the edges between them. A super instance kept
 * keeps every super-module it uses, directly or through others: its interface node, children and
 * edges. A handle whose every edge was cut becomes a ghost again, as an unused handle is.
 *
 * Takes store ids, not model ids (resolveScope's nodeIds name modules inside super instances by path). The
 * OMEX snapshot narrows only flat workspaces with it, where the two are the same; part of a nested
 * model is flattened instead (see services/flowSnapshot.js).
 *
 * @param {{nodes: Array, edges: Array}} flowState
 * @param {string[]|null} nodeIds - The store's ids of the nodes to keep, or null for every node.
 * @returns {{nodes: Array, edges: Array}}
 */
export function scopeFlowObject(flowState, nodeIds) {
  if (!nodeIds) return flowState
  const selected = withSupermodules(flowState.nodes, nodeIds)
  const edges = flowState.edges.filter((edge) => selected.has(edge.source) && selected.has(edge.target))
  const usedHandles = new Set(edges.flatMap((edge) => [`${edge.source}::${edge.sourceHandle}`, `${edge.target}::${edge.targetHandle}`]))

  const nodes = flowState.nodes
    .filter((node) => selected.has(node.id))
    .map((node) => {
      if (!node.data?.handles) return node
      const handles = node.data.handles.map((handle) =>
        handle.variant === HANDLE_VARIANT.GHOST || usedHandles.has(`${node.id}::${getHandleId(handle)}`)
          ? handle
          : { ...handle, variant: HANDLE_VARIANT.GHOST }
      )
      return { ...node, data: { ...node.data, handles } }
    })

  return { ...flowState, nodes, edges }
}

/**
 * Adds to some nodes the nodes of every super-module their super instances use, directly or through others.
 *
 * @param {Array} nodes - Every node in the store.
 * @param {string[]} nodeIds
 * @returns {Set<string>} The ids.
 */
function withSupermodules(nodes, nodeIds) {
  const selected = new Set(nodeIds)
  const byScope = indexByScope(nodes)
  const pending = nodes.filter((node) => selected.has(node.id) && isSuperInstance(node)).map((node) => node.data.smId)
  const seen = new Set()
  while (pending.length) {
    const smId = pending.pop()
    if (seen.has(smId)) continue
    seen.add(smId)
    for (const node of byScope.get(smId) ?? []) {
      selected.add(node.id)
      if (isSuperInstance(node)) pending.push(node.data.smId)
    }
  }
  return selected
}

/**
 * Lists the Sum variables in the scope that lose terms from outside it, one entry per variable.
 *
 * @param {ReturnType<typeof resolveScope>} scope
 * @returns {Array<{nodeId: string, nodeName: string, variableName: string, lost: number}>}
 */
function findLostSumTerms(scope) {
  const selected = new Set(scope.nodeIds)
  const lost = new Map()

  for (const edge of scope.cutEdges) {
    const isSourceInScope = selected.has(edge.source)
    const nodeId = isSourceInScope ? edge.source : edge.target
    const node = scope.nodes.find((candidate) => candidate.id === nodeId)

    for (const { sourcePort, targetPort } of edge.data?.couplings ?? []) {
      const port = isSourceInScope ? sourcePort : targetPort
      const otherPort = isSourceInScope ? targetPort : sourcePort
      const types = variableTypes(port ?? {})
      types.forEach((type, i) => {
        const variableName = port.variables[i]
        if (type !== 'Sum' || !variableName || !otherPort?.variables?.[i]) return
        const key = `${nodeId}::${variableName}`
        const entry = lost.get(key) ?? { nodeId, nodeName: node?.data?.name ?? nodeId, variableName, lost: 0 }
        entry.lost += 1
        lost.set(key, entry)
      })
    }
  }

  return [...lost.values()]
}

/**
 * Lists the coupling problems the build rejects inside a scope: ports whose variables can't pair.
 *
 * @param {ReturnType<typeof resolveScope>} scope
 * @returns {string[]}
 */
function findCouplingConflicts(scope) {
  const nameOf = (id) => scope.nodes.find((node) => node.id === id)?.data?.name ?? id
  const conflicts = []
  for (const edge of scope.internalEdges) {
    for (const { sourcePort, targetPort } of edge.data?.couplings ?? []) {
      for (const conflict of couplingConflicts(sourcePort, targetPort)) {
        conflicts.push(`Cannot connect "${nameOf(edge.source)}" to "${nameOf(edge.target)}": ${conflict}`)
      }
    }
  }
  return [...new Set(conflicts)]
}

/**
 * Resolves the whole model's boundary values, for comparison with a scope's. A problem outside the scope
 * doesn't concern it, so it gives null rather than throwing.
 *
 * @param {ReturnType<typeof resolveScope>} scope
 * @returns {ReturnType<typeof resolveBoundaryValues>|null}
 */
function resolveWholeBoundaryValues(scope) {
  try {
    return resolveBoundaryValues(scope.allNodes, scope.allEdges)
  } catch {
    return null
  }
}

/**
 * Checks a scope before it is flattened. Missing values, conflicts, incomplete nodes and boundary conditions
 * coupled only to each other in the whole model stop the build; lost Sum terms, trimmed inspection modules,
 * boundary conditions falling back to their own value and boundary conditions set to 0 for want of one are
 * warnings, since the scope still builds. A boundary condition the run itself supplies, as a sweep does, isn't set to 0
 * for long, so it isn't warned about. The problems expanding super instances found in the scope stop it or warn
 * (`modelWarnings`), as their severity says.
 *
 * @param {ReturnType<typeof resolveScope>} scope
 * @param {Object} libraryStore - Provides availableMath and getGlobalConstant(name).
 * @param {{suppliedKeys?: Set<string>}} [options] - `suppliedKeys`: the `nodeId::name` of the boundary conditions the
 *   run gives values of its own.
 * @returns {{canBuild: boolean, errors: string[], incompleteNodes: Array, missingValues: Array, conflicts: string[],
 *   lostSumTerms: Array, trimmedModules: Array, usesOwnValue: Array, zeroedBoundaries: Array, usesCelsius: Array,
 *   modelWarnings: string[]}}
 */
export function checkScope(scope, libraryStore, { suppliedKeys = new Set() } = {}) {
  const fromModel = summariseExpansionErrors(scope.modelErrors ?? [])
  const errors = [...fromModel.errors]
  const incompleteNodes = []
  const missingValues = []
  let conflicts = []
  let lostSumTerms = []
  const usesOwnValue = []
  const zeroedBoundaries = []
  const usesCelsius = []

  for (const node of scope.nodes) {
    const nodeName = node.data?.name ?? node.id
    if (!node.data?.mathRef) incompleteNodes.push({ nodeId: node.id, nodeName, reason: 'has no module' })
    else if (!libraryStore.availableMath.get(node.data.mathRef)) {
      incompleteNodes.push({ nodeId: node.id, nodeName, reason: `uses missing math "${node.data.mathRef}"` })
    }
  }

  // A selection without a differential equation is an algebraic system, solved once rather than over time.
  if (!scope.nodes.length) errors.push('Select at least one instance to simulate.')

  try {
    const scoped = resolveBoundaryValues(scope.nodes, scope.internalEdges)
    conflicts = [...scoped.conflicts, ...findCouplingConflicts(scope)]
    const whole = resolveWholeBoundaryValues(scope)

    // Boundary conditions coupled only to each other in the whole model, which export rejects too.
    const wholeBcOnly = new Set((whole?.bcOnly ?? []).flatMap(({ keys }) => keys))
    for (const { keys, label } of scoped.bcOnly) {
      if (keys.every((key) => wholeBcOnly.has(key))) {
        errors.push(`Boundary conditions connected only to each other, so nothing computes them: ${label}.`)
      }
    }

    for (const node of scope.nodes) {
      const nodeName = node.data?.name ?? node.id
      for (const row of node.data?.variables ?? []) {
        const entry = { nodeId: node.id, nodeName, variableName: row.name }
        if (row.units === 'celsius') usesCelsius.push(entry)
        if (scoped.missing.get(node.id)?.has(row.name)) {
          if (!suppliedKeys.has(`${node.id}::${row.name}`)) zeroedBoundaries.push(entry)
        }
        else if (row.type === 'constant' && isEmpty(row.value)) missingValues.push({ ...entry, kind: 'constant' })
        else if (row.type === 'global_constant' && isEmpty(libraryStore.getGlobalConstant(row.name)?.value)) {
          missingValues.push({ ...entry, kind: 'global_constant' })
        }

        const isNewlyUnsupplied = scoped.unsupplied.has(`${node.id}::${row.name}`) && !whole?.unsupplied.has(`${node.id}::${row.name}`)
        if (row.type === 'boundary_condition' && whole && isNewlyUnsupplied && !isEmpty(row.value)) usesOwnValue.push(entry)
      }
    }

    lostSumTerms = findLostSumTerms(scope)
  } catch (error) {
    errors.push(error.message)
  }

  return {
    canBuild: !errors.length && !incompleteNodes.length && !missingValues.length && !conflicts.length,
    errors,
    incompleteNodes,
    missingValues,
    conflicts,
    lostSumTerms,
    trimmedModules: scope.trimmedModules,
    usesOwnValue,
    zeroedBoundaries,
    usesCelsius,
    modelWarnings: fromModel.warnings,
  }
}

/**
 * Gives every boundary condition that nothing supplies and that has no value of its own the value 0.
 * The nodes are copied, never changed.
 *
 * @param {Array<Object>} nodes
 * @param {Array<Object>} edges
 * @returns {Array<Object>}
 */
function zeroUnsuppliedBoundaries(nodes, edges) {
  const { missing } = resolveBoundaryValues(nodes, edges)
  if (!missing.size) return nodes
  return nodes.map((node) => {
    const names = missing.get(node.id)
    if (!names) return node
    const variables = node.data.variables.map((row) => (names.has(row.name) ? { ...row, value: '0' } : row))
    return { ...node, data: { ...node.data, variables } }
  })
}

/**
 * Applies temporary parameter values to a scope, for one run: row values by `nodeId::name` and global
 * constants by name. The nodes and the library are copied or wrapped, never changed.
 *
 * @param {ReturnType<typeof resolveScope>} scope
 * @param {Object} libraryStore - Provides availableMath, availableUnits and getGlobalConstant(name).
 * @param {{rows?: Map<string, number>, globals?: Map<string, number>}} [overrides]
 * @returns {{scope: ReturnType<typeof resolveScope>, libraryStore: Object}}
 */
export function applyParameterOverrides(scope, libraryStore, { rows = new Map(), globals = new Map() } = {}) {
  const nodes = scope.nodes.map((node) => {
    const variables = (node.data.variables ?? []).map((row) => {
      const key = `${node.id}::${row.name}`
      return rows.has(key) ? { ...row, value: String(rows.get(key)) } : row
    })
    return variables.some((row, i) => row !== node.data.variables[i]) ? { ...node, data: { ...node.data, variables } } : node
  })
  const library = globals.size
    ? {
        availableMath: libraryStore.availableMath,
        availableUnits: libraryStore.availableUnits,
        getMathAnalysis: libraryStore.getMathAnalysis,
        getGlobalConstant: (name) => {
          const constant = libraryStore.getGlobalConstant(name)
          return globals.has(name) ? { ...constant, value: String(globals.get(name)) } : constant
        },
      }
    : libraryStore
  return { scope: { ...scope, nodes }, libraryStore: library }
}

/**
 * Flattens a scope into a standalone CellML model. A boundary condition nothing supplies and without a
 * value of its own is set to 0; checkScope lists them in `zeroedBoundaries`.
 *
 * @param {ReturnType<typeof resolveScope>} scope
 * @param {Object} libraryStore
 * @param {{check?: boolean}} [options] - See generateFlattenedModel; a simulation run skips the check, since
 *   libOpenCOR checks the model and reports its issues.
 * @returns {Blob} The flattened CellML model.
 * @throws {Error} When the scope can't be flattened; run checkScope first for a readable report.
 */
export function buildScopedModel(scope, libraryStore, options = {}) {
  if (!scope.nodes.length) throw new Error('Select at least one instance to simulate.')
  const nodes = zeroUnsuppliedBoundaries(scope.nodes, scope.internalEdges)
  // Boundary conditions the cut leaves coupled only to each other use their own value; checkScope stops those
  // coupled so in the whole model.
  return generateFlattenedModel(nodes, scope.internalEdges, libraryStore, scope.inspectionModules, { allowBcOnly: true, ...options })
}

/**
 * Builds a signature of everything a scope's flattened model depends on, so a cached model can be
 * reused until one of them changes. Nodes outside the scope don't affect it.
 *
 * @param {ReturnType<typeof resolveScope>} scope
 * @param {Object} libraryStore - Provides availableMath, availableUnits and getGlobalConstant(name).
 * @returns {number}
 */
export function buildScopeSignature(scope, libraryStore) {
  const nodes = scope.nodes.map(({ id, data }) => ({
    id,
    name: data?.name,
    mathRef: data?.mathRef,
    math: libraryStore.availableMath.get(data?.mathRef) ?? null,
    variables: data?.variables,
    ports: data?.ports,
    globals: (data?.variables ?? [])
      .filter((row) => row.type === 'global_constant')
      .map((row) => [row.name, libraryStore.getGlobalConstant(row.name) ?? null]),
  }))
  const edges = scope.internalEdges.map(({ source, target, data }) => ({ source, target, couplings: data?.couplings }))
  const modules = scope.inspectionModules.map(({ name, units, variables }) => ({ name, units, variables }))
  const units = (libraryStore.availableUnits ?? []).map(({ componentFile, model }) => [componentFile, model])

  return cyrb53(JSON.stringify({ nodes, edges, modules, units }))
}

/**
 * Words a checkScope report as readable lines: errors stop the build, warnings don't, and notes say what is expected,
 * such as a boundary condition falling back to its own value.
 *
 * @param {ReturnType<typeof checkScope>} report
 * @returns {{errors: string[], warnings: string[], notes: string[]}}
 */
export function summariseScopeReport(report) {
  const variable = ({ nodeName, variableName }) => `"${nodeName}.${variableName}"`
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

  const errors = [
    ...report.errors,
    ...report.incompleteNodes.map(({ nodeName, reason }) => `"${nodeName}" ${reason}.`),
    ...report.missingValues.map((entry) => `${variable(entry)} needs a value.`),
    ...report.conflicts,
  ]

  const warnings = [
    ...report.lostSumTerms.map(
      (entry) => `${variable(entry)} leaves out ${plural(entry.lost, 'term')} from outside the selection.`
    ),
    ...report.trimmedModules.map(({ name, removed, isLeftOut }) =>
      isLeftOut
        ? `Inspection module "${name}" has no variables in the selection, so it is left out.`
        : `Inspection module "${name}" leaves out ${plural(removed, 'variable')} from outside the selection.`
    ),
    ...report.zeroedBoundaries.map((entry) => `${variable(entry)} has no value and nothing in the selection supplies it, so it is set to 0.`),
    // stripCelsiusToArbitraryUnit (utils/cellml.js) drops the 273.15 K offset, which only differences survive.
    ...(report.usesCelsius ?? []).map(
      (entry) => `${variable(entry)} is in celsius, which is simulated without its 273.15 K offset: absolute temperatures will be wrong.`
    ),
    ...(report.modelWarnings ?? []),
  ]

  // One note for every boundary condition falling back to its own value, rather than a line each.
  const ownValues = report.usesOwnValue.map(variable)
  const notes = !ownValues.length
    ? []
    : ownValues.length === 1
      ? [`${ownValues[0]} uses its own value, since what supplies it is outside the selection.`]
      : [`These use their own values, since what supplies them is outside the selection: ${ownValues.join(', ')}.`]

  return { errors, warnings, notes }
}
