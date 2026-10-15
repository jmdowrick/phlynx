/**
 * The stores keyed by model node id (`nodeId`, or `nodeId::variable` keys): sliders, plots, sweeps, inspection modules,
 * slider values and the last run's scope. When the modules a key names go, as a child of a super-module is removed and
 * with it its copy in every subsystem, dropKeys takes the keys out of them all; when they move, as nesting and
 * un-nesting give them new model ids, remapNodeKeys follows them. Each is one change that can be put back.
 *
 * Every Pinia store is listed here, keyed or not (with why), so the registry test fails when a store is added without
 * being placed.
 */
import { useInspectionModuleStore } from '../../stores/inspectionModuleStore'
import { useSimulationResultsStore } from '../../stores/simulationResultsStore'
import { useSimulationSettingsStore } from '../../stores/simulationSettingsStore'
import { removePlotSelection, resolveGroups, setPlotXAxis } from '../simulation/plotSelections'

/** @returns {*} A deep copy of plain state. */
const copy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

/** @returns {string} The model id a `nodeId::variable` key names. */
const nodeIdOfKey = (key) => String(key).split('::')[0]

/**
 * Gives a key its new model id, when its own has one.
 *
 * @param {string} key - `nodeId::variable`, or a model id.
 * @param {Map<string, string>} idMap
 * @returns {string}
 */
const remapKey = (key, idMap) => {
  const [nodeId, ...rest] = String(key).split('::')
  return idMap.has(nodeId) ? [idMap.get(nodeId), ...rest].join('::') : key
}

/**
 * Gives every reference to a model node in plain state its new id: each object whose `nodeId` moves gets the new
 * `nodeId`, its `key` remapped and, where it has one, its `nodeName` the new name.
 *
 * @param {*} value - Plain state; not changed.
 * @param {Map<string, string>} idMap - Old model id to new.
 * @param {(id: string) => string|undefined} nameOf - A new model id's name.
 * @returns {*} A copy where anything moved, else the value.
 */
export function remapReferences(value, idMap, nameOf = () => undefined) {
  if (Array.isArray(value)) {
    const next = value.map((item) => remapReferences(item, idMap, nameOf))
    return next.some((item, i) => item !== value[i]) ? next : value
  }
  if (!value || typeof value !== 'object') return value
  let changed = false
  const next = {}
  for (const [field, item] of Object.entries(value)) {
    next[field] = remapReferences(item, idMap, nameOf)
    if (next[field] !== item) changed = true
  }
  if (typeof value.nodeId === 'string' && idMap.has(value.nodeId)) {
    const nodeId = idMap.get(value.nodeId)
    next.nodeId = nodeId
    if (typeof value.key === 'string') next.key = remapKey(value.key, idMap)
    if ('nodeName' in value) next.nodeName = nameOf(nodeId) ?? value.nodeName
    changed = true
  }
  return changed ? next : value
}

/**
 * The stores keyed by model node id. Each can `capture` its keyed state, `restore` it, `drop` the keys whose model id
 * `isDead` says is gone, and `remap` the keys whose model id moves, each returning whether anything changed.
 *
 * @type {Array<{id: string, use: Function, capture: Function, restore: Function, drop: Function, remap: Function}>}
 */
export const KEYED_STORES = [
  {
    id: 'simulationSettings',
    use: useSimulationSettingsStore,
    capture: (store) => ({
      plotConfig: copy(store.plotConfig),
      parameterScanConfig: copy(store.parameterScanConfig),
      sweep: copy(store.simulationSettings.sweep),
    }),
    restore: (store, state) => {
      store.setPlotConfig(state.plotConfig)
      store.setParameterScanConfig(state.parameterScanConfig)
      store.setSimulationSettings({ ...store.simulationSettings, sweep: state.sweep })
    },
    drop: (store, isDead) => {
      let changed = false
      let plotConfig = store.plotConfig
      for (const selection of plotConfig?.selections ?? []) {
        if (isDead(selection.nodeId)) plotConfig = removePlotSelection(plotConfig, selection.key)
      }
      for (const group of resolveGroups(plotConfig)) {
        if (group.xAxis && isDead(group.xAxis.nodeId)) plotConfig = setPlotXAxis(plotConfig, group.id, null)
      }
      if (plotConfig !== store.plotConfig) {
        store.setPlotConfig(plotConfig)
        changed = true
      }
      const sliders = store.parameterScanConfig?.selections ?? []
      if (sliders.some((slider) => isDead(slider.nodeId))) {
        store.setParameterScanConfig({ ...store.parameterScanConfig, selections: sliders.filter((slider) => !isDead(slider.nodeId)) })
        changed = true
      }
      const sweep = store.simulationSettings.sweep
      if (sweep && (isDead(sweep.nodeId) || (sweep.family && isDead(sweep.family.nodeId)))) {
        const { family: _family, ...withoutFamily } = sweep
        store.setSimulationSettings({ ...store.simulationSettings, sweep: isDead(sweep.nodeId) ? undefined : withoutFamily })
        changed = true
      }
      return changed
    },
    remap: (store, idMap, nameOf) => {
      const plotConfig = remapReferences(store.plotConfig, idMap, nameOf)
      const parameterScanConfig = remapReferences(store.parameterScanConfig, idMap, nameOf)
      const sweep = remapReferences(store.simulationSettings.sweep, idMap, nameOf)
      const changes = [plotConfig !== store.plotConfig, parameterScanConfig !== store.parameterScanConfig, sweep !== store.simulationSettings.sweep]
      if (changes[0]) store.setPlotConfig(plotConfig)
      if (changes[1]) store.setParameterScanConfig(parameterScanConfig)
      if (changes[2]) store.setSimulationSettings({ ...store.simulationSettings, sweep })
      return changes.some(Boolean)
    },
  },
  {
    id: 'inspectionModules',
    use: useInspectionModuleStore,
    capture: (store) => copy(store.modules),
    restore: (store, modules) => (store.modules = copy(modules)),
    drop: (store, isDead) => {
      const hit = store.modules.filter((module) => module.variables.some((variable) => isDead(variable.nodeId)))
      hit.forEach((module) => (module.variables = module.variables.filter((variable) => !isDead(variable.nodeId))))
      return hit.length > 0
    },
    remap: (store, idMap, nameOf) => {
      const modules = remapReferences(store.modules, idMap, nameOf)
      if (modules === store.modules) return false
      store.modules = modules
      return true
    },
  },
  {
    id: 'simulationResults',
    use: useSimulationResultsStore,
    capture: (store) => ({ sliderValues: new Map(store.sliderValues), scopeNodeIds: copy(store.scopeNodeIds) }),
    restore: (store, state) => {
      store.sliderValues = new Map(state.sliderValues)
      store.scopeNodeIds = copy(state.scopeNodeIds)
    },
    drop: (store, isDead) => {
      const kept = [...store.sliderValues].filter(([key]) => !isDead(nodeIdOfKey(key)))
      if (kept.length === store.sliderValues.size) return false
      store.sliderValues = new Map(kept)
      return true
    },
    remap: (store, idMap) => {
      let changed = false
      if ([...store.sliderValues.keys()].some((key) => idMap.has(nodeIdOfKey(key)))) {
        store.sliderValues = new Map([...store.sliderValues].map(([key, value]) => [remapKey(key, idMap), value]))
        changed = true
      }
      if (store.scopeNodeIds?.some((id) => idMap.has(id))) {
        store.scopeNodeIds = store.scopeNodeIds.map((id) => idMap.get(id) ?? id)
        changed = true
      }
      return changed
    },
  },
]

/**
 * The stores holding no key by model node id, with why.
 *
 * @type {Object<string, string>}
 */
export const UNKEYED_STORES = {
  flowHistory: 'Undo steps, which find nodes by id as they run.',
  library: 'Modules, math, units and global constants, by their own names.',
  libraryProxy: 'Library cards, by file and component.',
  nodeThemes: 'Colours by module type, not by node.',
  omex: 'The archive imported, by file.',
  protocol: 'Protocol targets name modules by their flat names, resolved through the expansion.',
  SessionMetadata: 'The session’s own details.',
}

/**
 * Takes out of every keyed store the keys whose model id is gone.
 *
 * @param {(modelId: string) => boolean} isDead
 * @returns {{changed: boolean, restore: (side: 'before'|'after') => void}} Whether anything went, and how to put each
 *   store back as it was before or after.
 */
export function dropKeys(isDead) {
  return changeKeys((entry, store) => entry.drop(store, isDead))
}

/**
 * Gives every keyed store's keys their modules' new model ids, as nesting and un-nesting move them.
 *
 * @param {Map<string, string>} idMap - Old model id to new.
 * @param {(id: string) => string|undefined} [nameOf] - A new model id's name, for the names shown beside keys.
 * @returns {{changed: boolean, restore: (side: 'before'|'after') => void}} As dropKeys's.
 */
export function remapNodeKeys(idMap, nameOf = () => undefined) {
  if (!idMap.size) return { changed: false, restore: () => {} }
  return changeKeys((entry, store) => entry.remap(store, idMap, nameOf))
}

/**
 * Changes every keyed store, keeping how to put each back.
 *
 * @param {(entry: Object, store: Object) => boolean} change
 * @returns {{changed: boolean, restore: (side: 'before'|'after') => void}}
 */
function changeKeys(change) {
  const entries = KEYED_STORES.map((entry) => ({ entry, store: entry.use() }))
  const before = entries.map(({ entry, store }) => entry.capture(store))
  const changed = entries.map(({ entry, store }) => change(entry, store)).some(Boolean)
  const after = entries.map(({ entry, store }) => entry.capture(store))
  const restore = (side) =>
    entries.forEach(({ entry, store }, i) => entry.restore(store, side === 'before' ? before[i] : after[i]))
  return { changed, restore }
}
