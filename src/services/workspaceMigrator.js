import { extractComponentsFromCellmlString } from '../utils/cellml'
import {
  MAIN_NODE_TYPE,
  HANDLE_VARIANT,
  PHLYNX_PROJECT_VERSION,
  PHLYNX_PROJECT_IDENTIFIER,
} from '../utils/constants'
import { normalisePorts, normaliseVariables, uniqueModuleRef } from '../utils/config'
import { buildGhostHandles, findMostCentralGhostHandle, withHierarchyHandles } from '../utils/handles'
import { rewriteUnsafeIds } from '../utils/hierarchy'
import { isBlank, isNumericLiteral } from '../utils/variables'
import { analyzeMathXml } from './math/analyzeMath'
import { getPortVariables, reconcileRows } from './math/reconcileRows'
import { separateParameters } from './math/separateParameters'

function mergeVariables(oldData, nodeName, globalConstantNames, paramLookup) {
  const typeLookup = {}
  ;(oldData.variables || []).forEach((v) => {
    typeLookup[v.name] = v
  })

  return (oldData.portOptions || []).map((opt) => {
    const name = opt.name
    const units = opt.units
    const legacyVar = typeLookup[name]
    const varType = legacyVar ? legacyVar.type : 'variable'
    const legacyValue = legacyVar && legacyVar.value !== undefined ? legacyVar.value : null

    let value = null
    let dataReference = null

    if (varType === 'global_constant') {
      value = null
      dataReference = null
    } else {
      const key = `${name}_${nodeName}`
      const match = paramLookup[key]
      if (match) {
        value = match.value !== undefined ? match.value : null
        dataReference = match.data_reference !== undefined ? match.data_reference : null
      } else {
        value = legacyValue
        dataReference = null
      }
    }

    return {
      name,
      value,
      units,
      access: 'access',
      type: varType,
      data_reference: dataReference,
    }
  })
}

function convertPorts(oldData) {
  return (oldData.portLabels || []).map((p) => ({
    portType: p.portType,
    label: p.label,
    variables: p.option || [],
    multiportType: p.multiport,
  }))
}

// Legacy port uids are only unique within a node: a copied node keeps its original's.
const portKey = (nodeId, uid) => `${nodeId}:${uid}`

function convertHandles(oldNodeId, oldData, uidMap) {
  const migratedHandles = buildGhostHandles()
  for (const port of oldData.ports) {
    const oldUid = port.uid
    const centralGhost = findMostCentralGhostHandle(port.side, migratedHandles)
    if (!centralGhost) return
    uidMap[portKey(oldNodeId, oldUid)] = centralGhost.uid
    const handle = migratedHandles.find((h) => h.uid === centralGhost.uid)
    if (handle) {
      handle.variant = HANDLE_VARIANT.DEFAULT
      handle.type = port.type
    }
  }
  return migratedHandles
}

function convertNode(node, newId, globalConstantNames, paramLookup, uidMap, moduleRefByConfig) {
  const oldData = node.data || {}
  const nodeName = oldData.name

  const sourceFile = oldData.sourceFile || ''
  const componentName = oldData.componentName || ''
  const moduleType = oldData.module_type || ''
  const bcType = oldData.BC_type || ''

  const newData = {
    name: nodeName,
    mathRef: `${sourceFile}:${componentName}`,
    // Legacy nodes don't keep their module's type, so it is found from the config they were made from.
    moduleRef:
      moduleRefByConfig.get(legacyConfigKey(sourceFile, componentName, oldData.configIndex)) ?? `${moduleType}:${bcType}`,
    variables: mergeVariables(oldData, nodeName, globalConstantNames, paramLookup),
    ports: convertPorts(oldData),
    handles: convertHandles(node.id, oldData, uidMap),
  }
  // The MVP's node colour category; the colour theme now maps it to a colour.
  if (oldData.domainType) newData.domainType = oldData.domainType

  const newNode = {
    id: newId,
    type: MAIN_NODE_TYPE,
    position: node.position,
    data: newData,
  }

  if ('style' in node) newNode.style = node.style
  return newNode
}

function convertPortRef(portRef) {
  if (!portRef) return null
  return {
    portType: portRef.portType,
    label: portRef.label,
    variables: portRef.option || [],
    multiportType: portRef.multiport,
  }
}

function convertEdge(edge, idMap, uidMap) {
  const oldSource = edge.source
  const oldTarget = edge.target
  let newSource = idMap[oldSource]
  let newTarget = idMap[oldTarget]

  if (!newSource || !newTarget) {
    console.warn(
      `Edge '${edge.id}': source/target (${oldSource}/${oldTarget}) not found in node id map; edge may be broken.`
    )
    newSource = newSource || oldSource
    newTarget = newTarget || oldTarget
  }

  function remapHandle(h, label, oldNodeId) {
    if (!h) return null
    let oldUid = h
    if (!h.startsWith('port_')) {
      console.warn(`Edge '${edge.id}': unexpected ${label} format '${h}' (expected 'port_<uid>'); left prefix as-is.`)
    } else {
      oldUid = h.slice(5)
    }

    let newUid = uidMap[portKey(oldNodeId, oldUid)]
    if (!newUid) {
      console.warn(
        `Edge '${edge.id}': ${label} uid '${oldUid}' not found among converted node handles; keeping original uid.`
      )
      newUid = oldUid
    }
    return `handle_${newUid}`
  }

  const oldCouplings = edge.data && edge.data.couplings ? edge.data.couplings : []
  const newCouplings = oldCouplings.map((c) => ({
    sourcePort: convertPortRef(c.sourcePortLabel),
    targetPort: convertPortRef(c.targetPortLabel),
  }))

  return {
    id: `${newSource}--${newTarget}`,
    type: edge.type,
    source: newSource,
    target: newTarget,
    sourceHandle: remapHandle(edge.sourceHandle, 'sourceHandle', oldSource),
    targetHandle: remapHandle(edge.targetHandle, 'targetHandle', oldTarget),
    data: { couplings: newCouplings },
    label: edge.label || '',
    markerEnd: edge.markerEnd,
    style: edge.style,
    sourceX: edge.sourceX,
    sourceY: edge.sourceY,
    targetX: edge.targetX,
    targetY: edge.targetY,
  }
}

function collectGlobalConstantNames(nodes) {
  const names = new Set()
  nodes.forEach((node) => {
    const vars = node.data && node.data.variables ? node.data.variables : []
    vars.forEach((v) => {
      if (v.type === 'global_constant') names.add(v.name)
    })
  })
  return names
}

function buildParamLookup(availableParameters) {
  const lookup = {}
  availableParameters.forEach(([key, entry]) => {
    const vname = entry.variable_name
    if (vname != null && !(vname in lookup)) {
      lookup[vname] = entry
    }
  })
  return lookup
}

function buildGlobalConstants(availableParameters, globalConstantNames, legacyGlobalConstants = []) {
  const result = []
  const seen = new Set()
  availableParameters.forEach(([key, entry]) => {
    const vname = entry.variable_name
    if (globalConstantNames.has(vname) && !seen.has(vname)) {
      seen.add(vname)
      result.push([
        vname,
        {
          value: entry.value,
          units: entry.units,
          data_reference: entry.data_reference,
        },
      ])
    }
  })
  // Constants set in the app are only in the old store's globalConstants, not in its parameters.
  legacyGlobalConstants.forEach(([vname, entry]) => {
    if (!seen.has(vname)) {
      seen.add(vname)
      result.push([vname, { value: entry.value, units: entry.units, data_reference: entry.data_reference ?? null }])
    }
  })
  return result
}

function extractComponentsToMathRefs(availableModules) {
  const newAvailableMath = {}
  if (!availableModules) return newAvailableMath

  for (const collection of availableModules) {
    if (!collection.model) continue

    const result = extractComponentsFromCellmlString(collection.model)

    if (result.errors && result.errors.length > 0) {
      console.warn(`Errors extracting components from ${collection.filename}:`, result.errors)
    }

    if (result.xml && Array.isArray(result.xml)) {
      for (const component of result.xml) {
        const mathRefKey = `${collection.filename}:${component.name}`
        newAvailableMath[mathRefKey] = component.math
      }
    }
  }

  return newAvailableMath
}

// Names a legacy module's config by the module it belongs to and its place among that module's configs.
const legacyConfigKey = (sourceFile, componentName, configIndex) => `${sourceFile}:${componentName}#${configIndex}`

/**
 * Turns the configs of legacy modules into library modules.
 *
 * @param {Array} availableModules - The legacy store's module collections.
 * @returns {{ modules: Object, moduleRefByConfig: Map<string, string> }} The modules by moduleRef,
 *   and the moduleRef made for each config, keyed `<sourceFile>:<componentName>#<configIndex>`.
 */
function extractModulesToModuleRefs(availableModules) {
  const newAvailableModules = {}
  const moduleRefByConfig = new Map()
  if (!availableModules) return { modules: newAvailableModules, moduleRefByConfig }

  for (const collection of availableModules) {
    const modulesList = collection.modules
    for (const modules of modulesList) {
      if (!modules.configs) continue
      modules.configs.forEach((config, configIndex) => {
        const moduleType = config.vessel_type
        const moduleSubtype = config.BC_type
        const componentFile = config.module_file
        const componentName = config.module_type

        const mathRef = `${componentFile}:${componentName}`
        const moduleRef = uniqueModuleRef(`${moduleType}:${moduleSubtype}`, mathRef, (ref) => newAvailableModules[ref])
        moduleRefByConfig.set(legacyConfigKey(modules.sourceFile, modules.componentName, configIndex), moduleRef)
        if (newAvailableModules[moduleRef]) return

        newAvailableModules[moduleRef] = {
          moduleRef,
          mathRef,
          ports: normalisePorts(config),
          variables: normaliseVariables(config.variables_and_units),
        }
      })
    }
  }
  return { modules: newAvailableModules, moduleRefByConfig }
}

function convertStore(oldStore, globalConstantNames, newAvailableModules) {
  const availableParameters = oldStore.availableParameters || []

  const newUnits = oldStore.availableUnits.map((u) => ({
    componentFile: u.filename,
    model: u.model,
  }))

  const newAvailableMath = extractComponentsToMathRefs(oldStore.availableModules)

  const newAvailableCollections = {}
  Object.values(newAvailableModules).forEach((mod) => {
    if (!newAvailableCollections[mod.mathRef]) {
      newAvailableCollections[mod.mathRef] = new Set()
    }
    newAvailableCollections[mod.mathRef].add(mod.moduleRef)
  })

  return {
    availableCollections: Object.entries(newAvailableCollections).map(([mathRef, moduleRefsSet]) => [
      mathRef,
      Array.from(moduleRefsSet),
    ]),
    availableModules: Object.entries(newAvailableModules),
    availableMath: Object.entries(newAvailableMath),
    availableUnits: newUnits,
    globalConstants: buildGlobalConstants(availableParameters, globalConstantNames, oldStore.globalConstants ?? []),
    lastSaveName: oldStore.lastSaveName,
  }
}

/*
 * Workspace file versions. A file is brought up to date by applying each step after its version.
 *
 * - legacy: no version. The store holds availableModules and availableParameters, and nodes keep
 *   portOptions and portLabels.
 * - 1.0.0: `{ id, version, flow, store, simulation, inspectionModules, workspace }`, as saved by the
 *   production site. Earlier saves used `{ info: { format_version: '1.0.0' } }` and may lack `simulation`.
 *   Math keeps its numeric initial values, and a blank row falls back to them.
 * - 1.1.0: math holds no numeric initial values, so the rows alone initialise the model. Each state
 *   names an initialiser variable, and store.mathDefaults holds the values taken out of each math.
 *   store.mathLayouts holds `[mathRef, TextLayout]` pairs: each math's CellML text comments, blank
 *   lines and statements as typed (see cellml-text-editor), which the XML can't hold.
 *   A port's multiportType and multiplyFactor may be lists, one entry per variable, when its
 *   variables differ (see utils/multiport.js); a whole-port value still means every variable, so
 *   1.0.0 ports need no migration.
 * - 1.2.0: simulation.simulationSettings' solver, timeStep, tolerance and maxSteps are applied, where
 *   before they were placeholders. `solver` is a key of SOLVERS (services/simulation/sedParameters.js).
 *   For CVODE, `tolerance` is its relative and absolute tolerance, `maxSteps` its maximum number of
 *   steps between output points, and `timeStep` its maximum step (0 for none); for a fixed-step solver,
 *   `timeStep` is its step. Older files get the settings every run used: CVODE, 1e-7, 500 and 0.
 *   A plotConfig selection's nodeId may be `inspection:<module id>`, an inspection module's output put on
 *   a plot, with variableName the module's name; older files have none.
 *   A parameterScanConfig selection may have a `label` (a CUFLynx params_for_id `name_for_plotting`,
 *   round-tripped through it); older files have none, and the UI falls back to `nodeName/parameterName`.
 *   simulation.simulationSettings may have a `sweep` (services/simulation/sweep.js): the parameter
 *   `{key, nodeId, nodeName, parameterName, units, type}` is solved, or with ODEs run, at `points` values
 *   from `from` to `to`, and for a model with ODEs each time course is read as `readout` ('end', 'min',
 *   'max' or 'peak'; missing means 'end'). Its `family`, when it has one, is a second parameter
 *   `{key, nodeId, nodeName, parameterName, units, type}` and the `values` it takes, a curve each.
 *   Older files have none. Whether play sweeps is the session's choice, not saved.
 * - 1.3.0: nested super instances. Every node has data.scope, null at the root or the id of the
 *   super-module it is a child of, and data.localId, its id within that scope (a root node's id).
 *   A nested node's id is `<smId>~<localId>`; no id holds `/` or `::`, nor `~` at the root, and an
 *   older file's ids that do are rewritten, with the edges and saved selections that name them.
 *   A super-module is its interface node, type 'supermoduleInterface' (deletable: false), whose
 *   data.supermodule is `{name, ca, submoduleOrder, localConstants, naming, source}` and data.handles
 *   its handles (see buildSupermoduleInterface). What it exposes lives on exposure edges, type
 *   'exposure', each joining one child and the interface node, either way round: data.exposed is
 *   `[{id, alias, label?, order}]`, each a whole port of the child, alias `{portType, label, slot}`
 *   on a module or `{via}` (an exposed port id) on a super instance; `order` orders the super-module's
 *   exposed ports, which are derived from these edges and never stored on their own (see
 *   services/hierarchy/exposure.js). Exposure edges are never in the model. A super instance, type
 *   'superInstanceNode', is one instance of a super-module, with data `{smId, overrides, ports, handles,
 *   broken?}` (see buildSuperInstance): ports are materialised from the exposed ports, each with its
 *   exposedPortId, as are the couplings to them; broken lists the exposed port ids couplings still
 *   name that are gone. Overrides are `{<localId path>: {<variable>: {value}}}`, and local constant
 *   values (H13) sit under '@'.
 *   A selection's nodeId and key may name a module inside a super instance by its expanded id, the
 *   local ids down to it joined with '/' (`dndnode_3/dndnode_1::V`). store.availableSupermodules
 *   holds the circulatory_autogen super-module templates of the library, `[[moduleRef, template]]` (see
 *   caModuleConfig.supermoduleTemplate); files saved before H9 have none. No node
 *   or edge is saved `hidden`. User-defined units (#714) stay in store.availableUnits, so units
 *   need no field of their own. The OMEX flow snapshot (services/flowSnapshot.js) has a
 *   snapshotKind from 1.3.0.
 */
const LEGACY_VERSION = 'legacy'

// The solver settings every simulation and export used before 1.2.0, whatever the file held.
const SOLVER_SETTINGS_BEFORE_1_2_0 = Object.freeze({ solver: 'CVODE', timeStep: 0, tolerance: 1e-7, maxSteps: 500 })

const MIGRATIONS = [
  { from: LEGACY_VERSION, to: '1.0.0', migrate: migrateLegacyTo1_0_0 },
  { from: '1.0.0', to: '1.1.0', migrate: migrate1_0_0To1_1_0 },
  { from: '1.1.0', to: '1.2.0', migrate: migrate1_1_0To1_2_0 },
  { from: '1.2.0', to: '1.3.0', migrate: migrate1_2_0To1_3_0 },
]

/**
 * Takes values out of older math and puts them in the rows of the nodes using it, so the rows
 * alone initialise the model. Math already separated, and its nodes, come back unchanged.
 *
 * @param {Array} nodes - Workspace nodes.
 * @param {Array<[string, string]>} mathEntries - mathRef and math pairs.
 * @returns {{ nodes: Array, mathEntries: Array<[string, string]>, mathDefaults: Array<[string, Array<[string, string]>]>,
 *   globalValues: Map<string, { value: string, units: string, data_reference: ?string }> }}
 *   The nodes and math, the values taken out of each math, as libraryStore.getState saves them, and
 *   the first value taken out for each global constant, as a libraryStore global constant entry.
 */
export function separateNodeParameters(nodes, mathEntries) {
  const separatedByRef = new Map()
  const separatedEntries = mathEntries.map(([mathRef, math]) => {
    const separated = separateParameters(math)
    if (separated.math !== math) separatedByRef.set(mathRef, separated)
    return [mathRef, separated.math]
  })

  const globalValues = new Map()
  const separatedNodes = nodes.map((node) => {
    const separated = separatedByRef.get(node.data?.mathRef)
    if (!separated) return node

    // Before, a blank row fell back to the math's value, so a blank row takes that value now.
    const { values, initialisers } = separated
    const previousRows = node.data.variables ?? []
    const rows = previousRows.map((row) =>
      isBlank(row.value) && values.has(row.name) ? { ...row, value: values.get(row.name) } : row
    )
    const variables = reconcileRows(analyzeMathXml(separated.math), rows, {
      portVariables: getPortVariables(node.data.ports),
      defaults: values,
    })
    carryStateInitialValues(variables, previousRows, initialisers)
    for (const row of variables) {
      if (row.type !== 'global_constant' || !values.has(row.name) || globalValues.has(row.name)) continue
      globalValues.set(row.name, {
        value: values.get(row.name),
        units: row.units,
        data_reference: row.data_reference ?? null,
      })
    }
    return { ...node, data: { ...node.data, variables } }
  })

  const mathDefaults = Array.from(separatedByRef, ([mathRef, { values }]) => [mathRef, Array.from(values)]).filter(
    ([, values]) => values.length
  )

  return { nodes: separatedNodes, mathEntries: separatedEntries, mathDefaults, globalValues }
}

/**
 * Gives each initialiser created by separation its state's numeric value and data reference, since
 * the state's value was its initial value.
 *
 * @param {Array} rows - Reconciled rows; mutated in place.
 * @param {Array} previousRows - The rows before separation.
 * @param {Set<string>} initialisers - The initialiser names separation created.
 */
function carryStateInitialValues(rows, previousRows, initialisers) {
  const previousByName = new Map(previousRows.map((row) => [row.name, row]))
  const rowsByName = new Map(rows.map((row) => [row.name, row]))
  for (const row of rows) {
    const initialiserRow = rowsByName.get(row.initialiser)
    if (row.stateRole !== 'state' || !initialisers.has(row.initialiser) || !initialiserRow) continue
    const previous = previousByName.get(row.name)
    const value = String(previous?.value ?? '').trim()
    if (isNumericLiteral(value)) initialiserRow.value = value
    const reference = previous?.data_reference
    if (reference != null && initialiserRow.data_reference == null) initialiserRow.data_reference = reference
  }
}

/**
 * Gets the format version of a saved workspace.
 *
 * @param {Object} doc - A parsed workspace file.
 * @returns {string} The version, or 'legacy' for files saved before versioning.
 */
export function detectVersion(doc) {
  return doc?.version ?? doc?.info?.format_version ?? LEGACY_VERSION
}

// The settings files saved without any were given when 1.0.0 came in. Kept as they were, so those files
// load the same however the app's defaults change.
const SETTINGS_FOR_FILES_WITHOUT_ANY = Object.freeze({
  pointInterval: 0.01,
  startingPoint: 0.0,
  endingPoint: 10.0,
  initialPoint: 0.0,
  solver: 'CVODE',
  timeStep: 0.0,
  tolerance: 1e-6,
  maxSteps: 10000,
})

/**
 * Gets the simulation block 1.0.0 requires, for files saved before it was always written.
 *
 * @returns {Object}
 */
function defaultSimulation() {
  return { simulationSettings: { ...SETTINGS_FOR_FILES_WITHOUT_ANY }, plotConfig: {}, parameterScanConfig: {} }
}

/**
 * Gives a versioned workspace the current envelope, replacing the earlier `info` block.
 *
 * @param {Object} doc - A versioned workspace file.
 * @param {string} version - Its version.
 * @returns {Object}
 */
function normaliseEnvelope(doc, version) {
  const normalised = {
    ...doc,
    id: PHLYNX_PROJECT_IDENTIFIER,
    version,
    simulation: doc.simulation ?? defaultSimulation(),
    inspectionModules: doc.inspectionModules ?? [],
  }
  delete normalised.info
  return normalised
}

/**
 * Brings a saved workspace from any version up to the current one.
 *
 * @param {Object} doc - A parsed workspace file.
 * @param {Object} [options]
 * @param {string[]} [options.notes] - Collects what the steps changed that the user should hear of, such as
 *   rewritten ids.
 * @returns {Object} The workspace at PHLYNX_PROJECT_VERSION.
 * @throws {Error} If the version is unknown, e.g. saved by a newer PhLynx.
 */
export function migrateWorkspace(doc, { notes = [] } = {}) {
  const version = detectVersion(doc)
  const current = version === LEGACY_VERSION ? doc : normaliseEnvelope(doc, version)
  if (version === PHLYNX_PROJECT_VERSION) return withLoadedHandles(current)

  const start = MIGRATIONS.findIndex((step) => step.from === version)
  if (start === -1) {
    throw new Error(`Unsupported workspace version '${version}'. It may have been saved by a newer version of PhLynx.`)
  }
  return withLoadedHandles(
    MIGRATIONS.slice(start).reduce((migrated, step) => ({ ...step.migrate(migrated, notes), version: step.to }), current)
  )
}

/**
 * Gives super instance and interface nodes saved without handles their ghosts (see withHierarchyHandles).
 *
 * @param {Object} doc - A workspace at the current version.
 * @returns {Object} The workspace, copied when any node changed.
 */
function withLoadedHandles(doc) {
  const nodes = doc.flow?.nodes
  if (!Array.isArray(nodes)) return doc
  const repaired = nodes.map(withHierarchyHandles)
  return repaired.some((node, index) => node !== nodes[index]) ? { ...doc, flow: { ...doc.flow, nodes: repaired } } : doc
}

/**
 * 1.2.0 -> 1.3.0: puts every node at the root (data.scope null, data.localId its id), and rewrites ids
 * that break the id rules (see utils/hierarchy.js rewriteUnsafeIds), with the edges and the saved
 * selections that name them. Nothing else changes.
 *
 * @param {Object} doc - A 1.2.0 workspace.
 * @param {string[]} notes - Collects a note of each rewritten id.
 * @returns {Object}
 */
function migrate1_2_0To1_3_0(doc, notes) {
  const flow = doc.flow ?? {}
  const { nodes, edges, idMap } = rewriteUnsafeIds(flow.nodes ?? [], flow.edges ?? [])
  for (const [from, to] of idMap) notes.push(`Node id "${from}" is now "${to}": ids can't hold "/", "::" or "~".`)
  return {
    ...doc,
    flow: {
      ...flow,
      nodes: nodes.map((node) => ({
        ...node,
        data: { ...node.data, scope: node.data?.scope ?? null, localId: node.data?.localId ?? node.id },
      })),
      edges,
    },
    ...(doc.simulation && { simulation: remapNodeIds(doc.simulation, idMap) }),
    ...(doc.inspectionModules && { inspectionModules: remapNodeIds(doc.inspectionModules, idMap) }),
  }
}

// Fields that hold names, never ids, so a name that reads as an old id is kept.
const NAME_FIELDS = new Set(['name', 'nodeName', 'variableName', 'label', 'title'])

/**
 * Renames node ids wherever saved settings name them: a string that is an old id, or a `<id>::<variable>`
 * key, as a value or an object key (plot, slider and sweep selections, inspection module variables). A
 * name field's value is left alone.
 *
 * @param {*} value
 * @param {Map<string, string>} idMap - Each old id's new id.
 * @returns {*} The value, copied where anything was renamed.
 */
function remapNodeIds(value, idMap) {
  if (!idMap.size) return value
  // Longest first, so an id that starts another (`a` and `a::b`) never takes the other's keys.
  const oldIds = [...idMap.keys()].sort((a, b) => b.length - a.length)
  const renameText = (text) => {
    for (const oldId of oldIds) {
      if (text === oldId) return idMap.get(oldId)
      if (text.startsWith(`${oldId}::`)) return `${idMap.get(oldId)}${text.slice(oldId.length)}`
    }
    return text
  }
  const visit = (item) => {
    if (typeof item === 'string') return renameText(item)
    if (Array.isArray(item)) return item.map(visit)
    if (!item || typeof item !== 'object') return item
    return Object.fromEntries(
      Object.entries(item).map(([key, child]) => [renameText(key), NAME_FIELDS.has(key) && typeof child === 'string' ? child : visit(child)])
    )
  }
  return visit(value)
}

/**
 * 1.1.0 -> 1.2.0: gives the simulation settings the solver settings that were used, since the solver,
 * time step, tolerance and maximum steps the file held were never applied before 1.2.0.
 *
 * @param {Object} doc - A 1.1.0 workspace.
 * @returns {Object}
 */
function migrate1_1_0To1_2_0(doc) {
  if (!doc.simulation) return doc
  return {
    ...doc,
    simulation: {
      ...doc.simulation,
      simulationSettings: { ...doc.simulation.simulationSettings, ...SOLVER_SETTINGS_BEFORE_1_2_0 },
    },
  }
}

/**
 * 1.0.0 -> 1.1.0: moves the math's values into the rows and records them as math defaults. A global
 * constant with no stored value takes its math value. Math from 1.0.0 has no text layouts.
 *
 * @param {Object} doc - A 1.0.0 workspace.
 * @returns {Object}
 */
function migrate1_0_0To1_1_0(doc) {
  const store = doc.store ?? {}
  const mathEntries = Array.isArray(store.availableMath) ? store.availableMath : Object.entries(store.availableMath ?? {})
  const { nodes, mathEntries: separatedEntries, mathDefaults, globalValues } = separateNodeParameters(
    doc.flow?.nodes ?? [],
    mathEntries
  )
  // Before, a global with no stored value fell back to the math's value.
  const globalConstants = new Map(store.globalConstants ?? [])
  for (const [name, entry] of globalValues) {
    const stored = globalConstants.get(name)
    if (isBlank(stored?.value)) globalConstants.set(name, stored ? { ...stored, value: entry.value } : entry)
  }
  return {
    ...doc,
    flow: { ...doc.flow, nodes },
    store: {
      ...store,
      availableMath: separatedEntries,
      mathDefaults,
      mathLayouts: store.mathLayouts ?? [],
      globalConstants: Array.from(globalConstants),
    },
  }
}

/**
 * legacy -> 1.0.0: converts a pre-versioning build file.
 *
 * @param {Object} doc - A legacy workspace.
 * @returns {Object}
 */
function migrateLegacyTo1_0_0(doc) {
  const oldFlow = doc.flow
  const oldStore = doc.store
  const oldNodes = oldFlow.nodes
  const oldEdges = oldFlow.edges

  // Sequential id map
  const idMap = {}
  oldNodes.forEach((n, i) => {
    idMap[n.id] = `dndnode_${i}`
  })

  const globalConstantNames = collectGlobalConstantNames(oldNodes)
  const paramLookup = buildParamLookup(oldStore.availableParameters || [])

  const uidMap = {}

  const { modules, moduleRefByConfig } = extractModulesToModuleRefs(oldStore.availableModules)
  const newNodes = oldNodes.map((n) =>
    convertNode(n, idMap[n.id], globalConstantNames, paramLookup, uidMap, moduleRefByConfig)
  )

  const newEdges = oldEdges.map((e) => convertEdge(e, idMap, uidMap))

  const newFlow = {
    nodes: newNodes,
    edges: newEdges,
    position: oldFlow.position,
    zoom: oldFlow.zoom,
    viewport: oldFlow.viewport,
  }

  return {
    id: PHLYNX_PROJECT_IDENTIFIER,
    version: '1.0.0',
    flow: newFlow,
    store: convertStore(oldStore, globalConstantNames, modules),
    simulation: {
      simulationSettings: { ...SETTINGS_FOR_FILES_WITHOUT_ANY },
      plotConfig: {},
      parameterScanConfig: {},
    },
    inspectionModules: [],
  }
}
