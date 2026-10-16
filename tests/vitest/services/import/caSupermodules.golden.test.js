import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'

import { normaliseModuleRecords } from '../../../../src/services/import/caModuleArray.js'
import { normaliseConfigEntry, supermoduleTemplate } from '../../../../src/services/import/caModuleConfig.js'
import { expandSupermodules, mergeDefaultParameters } from '../../../../src/services/import/caSupermodules.js'

// circulatory_autogen's own output for these fixtures, written by tests/resources/ca-supermodules/regen.py.
const ROOT = join(__dirname, '../../../resources/ca-supermodules')
const LIBRARY = join(ROOT, 'library')
const expected = JSON.parse(readFileSync(join(ROOT, 'expected.json'), 'utf8'))
const LIBRARY_CONFIGS = [
  'modules/heart/versions/Argus2026_v01/heart_Argus2026_v01_modules_config.json',
  'modules/cell/neuron/versions/sympathetic/neuron_sympathetic_modules_config.json',
  'modules/cell/neuron/soma/versions/sympathetic/soma_sympathetic_modules_config.json',
  'modules/cell/neuron/varicosity/versions/sympathetic/varicosity_sympathetic_modules_config.json',
]
const OLD_FORM = 'are written {variable}_{submodule}'
const CONFLICT = 'is set to different values by module parameterisations'
const UNLISTED = new Set(['error_unknown_parameterisation'])

const parseCsv = (text) =>
  Papa.parse(text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() }).data.filter((row) =>
    row.variable_name?.trim()
  )

const outcome = (run) => {
  try {
    return run()
  } catch (error) {
    return { error: error.message }
  }
}

const registryOf = (entries, configFile) =>
  new Map(entries.map((entry) => supermoduleTemplate(entry, configFile)).map((t) => [t.moduleRef, t]))

/** Reads parameterisations/<p>/<p>_parameters.csv and default_parameters next to the config, from `read`. */
const loaderFrom = (read) => (template, { parameterisation, file }) => {
  const relative = file ?? `parameterisations/${parameterisation}/${parameterisation}_parameters.csv`
  const text = read(join(dirname(template.configFile), relative))
  return text === undefined ? null : parseCsv(text)
}

const readLibrary = (path) => {
  try {
    return readFileSync(join(LIBRARY, path), 'utf8')
  } catch {
    return undefined
  }
}

// CA writes a module config entry in libcuflynx keys; PhLynx reads it in its own.
const CONFIG_KEYS = { vessel_type: 'module_type', BC_type: 'module_subtype', module_file: 'component_file', module_type: 'component_type' }
const inPhlynxKeys = (entry) => Object.fromEntries(Object.entries(entry).map(([k, v]) => [CONFIG_KEYS[k] ?? k, v]))

describe('the circulatory_autogen golden expansions', () => {
  it('come from the pinned circulatory_autogen commit', () => {
    expect(expected.circulatory_autogen).toBe('fceb3e3166944c954116b7460bc4a1f98239834f')
  })

  it.each(expected.expansion.map((c) => [c.name, c]))('%s', (_name, testCase) => {
    const registry = registryOf(testCase.supermodules, 'super_modules_config.json')
    const load = loaderFrom((path) => testCase.files[path])
    const result = outcome(() => {
      const { records, parameterRows, warnings } = expandSupermodules(normaliseModuleRecords(testCase.records, 'test'), registry, {
        source: 'test',
        load,
      })
      return { records, parameter_rows: parameterRows, warnings }
    })
    if (testCase.expected.error) {
      // CA also lists the parameterisations there are, from a directory the port does not have.
      if (UNLISTED.has(testCase.name)) expect(testCase.expected.error.startsWith(result.error)).toBe(true)
      else expect(result.error).toBe(testCase.expected.error)
      return
    }
    expect(result.records).toEqual(testCase.expected.records)
    expect(result.parameter_rows).toEqual(testCase.expected.parameter_rows)
    expect(result.warnings.some((w) => w.includes(OLD_FORM))).toBe(testCase.expected.warnings.length > 0)
    expect(result.warnings.filter((w) => w.includes(CONFLICT))).toEqual(testCase.expected.conflicts)
  })
})

describe('the circulatory_autogen golden reader', () => {
  it.each(expected.reader.map((c) => [c.name, c]))('%s', (_name, testCase) => {
    const result = outcome(() => ({ records: normaliseModuleRecords(testCase.records, 'test.json') }))
    if (testCase.expected.error) expect(result.error).toBe(testCase.expected.error)
    else expect(result.records).toEqual(testCase.expected.records)
  })

  it('keeps unknown keys in their place after the record keys', () => {
    const [record] = normaliseModuleRecords(expected.reader.find((c) => c.name === 'unknown_keys_kept').records)
    expect(Object.keys(record)).toEqual([
      'name',
      'module_type',
      'module_subtype',
      'inp_instances',
      'out_instances',
      'label',
      'description',
      'phlynx_layout',
      'parameterisation',
    ])
  })
})

describe('the circulatory_autogen golden module config entries', () => {
  it.each(expected.config.map((c) => [c.name, c]))('%s', (_name, testCase) => {
    const result = outcome(() => ({ entry: normaliseConfigEntry(testCase.entry, 'lib/x_modules_config.json') }))
    if (testCase.expected.error) expect(result.error).toBe(testCase.expected.error)
    else expect(result.entry).toEqual(inPhlynxKeys(testCase.expected.entry))
  })
})

describe('the circulatory-autogen-modules super-module system models', () => {
  const registry = new Map(
    LIBRARY_CONFIGS.flatMap((file) => JSON.parse(readLibrary(file)).map((entry) => supermoduleTemplate(entry, file))).map(
      (template) => [template.moduleRef, template]
    )
  )
  const expand = (testCase, options = {}) =>
    expandSupermodules(normaliseModuleRecords(JSON.parse(readLibrary(testCase.array)), testCase.array), registry, {
      source: testCase.array,
      load: loaderFrom(readLibrary),
      ...options,
    })

  it.each(expected.library.map((c) => [c.name, c]))('%s expands, and merges its parameters, as CA does', (_name, testCase) => {
    const { records, parameterRows, warnings } = expand(testCase)
    expect(records).toEqual(testCase.expected.records)
    expect(parameterRows).toEqual(testCase.expected.parameter_rows)
    expect(warnings.some((w) => w.includes(OLD_FORM))).toBe(testCase.expected.warnings.length > 0)
    expect(warnings.filter((w) => w.includes(CONFLICT))).toEqual(testCase.expected.conflicts)
    const host = parseCsv(readLibrary(testCase.parameters)).map((row) =>
      Object.fromEntries(['variable_name', 'units', 'value', 'data_reference'].map((c) => [c, row[c].trim()]))
    )
    expect(mergeDefaultParameters(host, parameterRows)).toEqual(testCase.expected.merged_parameters)
  })

  // CA joins levels with '_' until CA#582; PhLynx's '__' gives the same records, mapped at the level boundaries.
  it.each(expected.library.map((c) => [c.name, c]))('%s with "__" between levels maps onto CA by path', (_name, testCase) => {
    const ca = expand(testCase)
    const phlynx = expand(testCase, { separator: '__' })
    const caName = new Map(phlynx.records.map((record) => [record.name, phlynx.paths.get(record.name).join('_')]))
    expect(phlynx.records.map((record) => phlynx.paths.get(record.name).join('__'))).toEqual(
      phlynx.records.map((record) => record.name)
    )
    const mapped = phlynx.records.map((record) => ({
      ...record,
      name: caName.get(record.name),
      inp_instances: record.inp_instances.map((n) => caName.get(n)),
      out_instances: record.out_instances.map((n) => caName.get(n)),
    }))
    expect(mapped).toEqual(ca.records)
    const vessels = [...caName].sort(([a], [b]) => b.length - a.length)
    const caRow = (name) => {
      const match = vessels.find(([flat]) => name.endsWith(`_${flat}`))
      return match ? `${name.slice(0, -match[0].length)}${match[1]}` : name
    }
    expect(phlynx.parameterRows.map((row) => caRow(row.variable_name))).toEqual(ca.parameterRows.map((r) => r.variable_name))
  })
})
