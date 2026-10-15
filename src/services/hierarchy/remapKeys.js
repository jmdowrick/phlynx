/**
 * The stores keyed by model node id (`nodeId`, or `nodeId::variable` keys): sliders, plots, sweeps, inspection modules
 * and slider values. When the modules a key names go, as a child of a super-module is removed and with it its copy in
 * every subsystem, dropKeys takes the keys out of them all, as one change that can be put back.
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
 * The stores keyed by model node id. Each can `capture` its keyed state, `restore` it, and `drop` the keys whose
 * model id `isDead` says is gone, returning whether anything went.
 *
 * @type {Array<{id: string, use: Function, capture: Function, restore: Function, drop: Function}>}
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
  },
  {
    id: 'simulationResults',
    use: useSimulationResultsStore,
    capture: (store) => new Map(store.sliderValues),
    restore: (store, values) => (store.sliderValues = new Map(values)),
    drop: (store, isDead) => {
      const kept = [...store.sliderValues].filter(([key]) => !isDead(nodeIdOfKey(key)))
      if (kept.length === store.sliderValues.size) return false
      store.sliderValues = new Map(kept)
      return true
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
  const entries = KEYED_STORES.map((entry) => ({ entry, store: entry.use() }))
  const before = entries.map(({ entry, store }) => entry.capture(store))
  const changed = entries.map(({ entry, store }) => entry.drop(store, isDead)).some(Boolean)
  const after = entries.map(({ entry, store }) => entry.capture(store))
  const restore = (side) =>
    entries.forEach(({ entry, store }, i) => entry.restore(store, side === 'before' ? before[i] : after[i]))
  return { changed, restore }
}
