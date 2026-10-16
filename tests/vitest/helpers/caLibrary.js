/**
 * Loads the circulatory-autogen-modules files under tests/resources/ca-supermodules/library into a library store, as
 * the import dialog does with a dropped folder: each version's CellML, units and config, and its parameter files.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import Papa from 'papaparse'

import { normaliseModuleRecords } from '../../../src/services/import/caModuleArray.js'
import { moduleRefOf } from '../../../src/services/import/caModuleConfig.js'
import { parameterFileLoader } from '../../../src/services/import/caParameters.js'
import { processCellMLData } from '../../../src/utils/cellml.js'

export const CA_ROOT = join(__dirname, '../../resources/ca-supermodules/library')

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  )

/** @returns {Object[]} A CSV's rows that name a variable. */
export const parseCsv = (text) =>
  Papa.parse(text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() }).data.filter((row) =>
    row.variable_name?.trim()
  )

/** @returns {string} A library file's text. */
export const readCa = (path) => readFileSync(join(CA_ROOT, path), 'utf8')

/**
 * Loads every module version under the library into a store.
 *
 * @param {Object} store - A libraryStore.
 * @returns {{files: Map<string, Object[]>, configPaths: Map<string, string>, load: Function}} The parameter files by
 *   path, each config's path by moduleRef, and a loader over them.
 */
export function loadCaLibrary(store) {
  const paths = walk(join(CA_ROOT, 'modules')).map((path) => relative(CA_ROOT, path))
  for (const path of paths.filter((p) => p.endsWith('_units.cellml'))) {
    const result = processCellMLData(readCa(path))
    if (result.units.count > 0) store.addUnitsFile({ componentFile: path.split('/').at(-1), model: result.units.model })
  }
  for (const path of paths.filter((p) => p.endsWith('_modules.cellml'))) {
    const result = processCellMLData(readCa(path))
    if (result.type !== 'success') throw new Error(`Could not load ${path}.`)
    store.addMathFile(path.split('/').at(-1), result.components)
  }
  const configPaths = new Map()
  // Components before super-modules, as a super-module checks its submodules' types.
  const configs = paths.filter((p) => p.endsWith('_modules_config.json')).map((path) => [path, JSON.parse(readCa(path))])
  const isSupermodule = ([, entries]) => entries.some((entry) => entry.module_format === 'supermodule')
  for (const [path, entries] of [...configs.filter((c) => !isSupermodule(c)), ...configs.filter(isSupermodule)]) {
    store.addConfigFile(path.split('/').at(-1), entries)
    for (const entry of entries) {
      configPaths.set(moduleRefOf(entry.module_type ?? entry.vessel_type, entry.module_subtype ?? entry.BC_type), path)
    }
  }
  const files = new Map(paths.filter((p) => p.endsWith('.csv')).map((path) => [path, parseCsv(readCa(path))]))
  return { files, configPaths, load: parameterFileLoader(files, configPaths) }
}

/**
 * A system model's module array and host parameters.
 *
 * @param {string} dir - E.g. `system_models/closed_loop_cvs/3compartment_supermodules`.
 * @returns {{rows: Object[], hostRows: Object[]}}
 */
export function systemModel(dir) {
  const name = dir.split('/').at(-1)
  return {
    rows: normaliseModuleRecords(JSON.parse(readCa(`${dir}/${name}_module_array.json`)), name),
    hostRows: parseCsv(readCa(`${dir}/${name}_parameters.csv`)),
  }
}

/** @returns {Object} The library a store holds, as caFold reads it. */
export const libraryOf = (store) => ({
  supermodules: store.availableSupermodules,
  modules: store.availableModules,
  getMathAnalysis: store.getMathAnalysis,
  getMathDefaults: store.getMathDefaults,
  variants: store.caVariants,
})
