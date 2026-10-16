import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import arraySchema from '../../../../src/services/import/ca-schemas/module_array.schema.json'
import configSchema from '../../../../src/services/import/ca-schemas/module_config.schema.json'
import { normaliseModuleRecord, normaliseModuleRecords } from '../../../../src/services/import/caModuleArray.js'
import { normaliseModuleConfig } from '../../../../src/services/import/caModuleConfig.js'
import { isValid } from '../../helpers/jsonSchema.js'

// The readers port config_schemas.py rather than run the vendored schemas; these keep the two in step.
const ROOT = join(__dirname, '../../../resources/ca-supermodules')
const expected = JSON.parse(readFileSync(join(ROOT, 'expected.json'), 'utf8'))
const library = (path) => JSON.parse(readFileSync(join(ROOT, 'library', path), 'utf8'))
const accepts = (run) => {
  try {
    run()
    return true
  } catch {
    return false
  }
}

// What CA's loader refuses but JSON Schema cannot express (see the schemas' descriptions).
const LOADER_ONLY = new Set(['error_not_a_sibling', 'error_repeated_submodule', 'error_both_default_names'])

describe('the vendored circulatory_autogen schemas', () => {
  it.each(expected.reader.map((c) => [c.name, c]))('module array %s: the schema and the reader agree', (_name, testCase) => {
    expect(isValid(arraySchema, testCase.records)).toBe(!testCase.expected.error)
    expect(accepts(() => normaliseModuleRecords(testCase.records, 'test.json'))).toBe(!testCase.expected.error)
  })

  it.each(expected.config.map((c) => [c.name, c]))('module config %s: the schema and the reader agree', (name, testCase) => {
    expect(accepts(() => normaliseModuleConfig([testCase.entry]))).toBe(!testCase.expected.error)
    if (!LOADER_ONLY.has(name)) expect(isValid(configSchema, [testCase.entry])).toBe(!testCase.expected.error)
  })

  it('accept the super-module system models and their configs, as the readers do', () => {
    const arrays = expected.library.map((c) => library(c.array))
    arrays.forEach((records) => {
      expect(isValid(arraySchema, records)).toBe(true)
      expect(accepts(() => normaliseModuleRecords(records))).toBe(true)
    })
    const configs = [
      'modules/heart/versions/Argus2026_v01/heart_Argus2026_v01_modules_config.json',
      'modules/cell/neuron/versions/sympathetic/neuron_sympathetic_modules_config.json',
      'modules/cell/neuron/soma/versions/sympathetic/soma_sympathetic_modules_config.json',
      'modules/cell/neuron/varicosity/versions/sympathetic/varicosity_sympathetic_modules_config.json',
    ].map(library)
    configs.forEach((entries) => {
      expect(isValid(configSchema, entries)).toBe(true)
      expect(accepts(() => normaliseModuleConfig(entries))).toBe(true)
    })
  })

  it("differ only where PhLynx reads legacy files: a record's instance key", () => {
    const record = { name: 'a', module_type: 'x', module_subtype: 'nn', instance: 'healthy' }
    expect(isValid(arraySchema, [record])).toBe(false)
    expect(normaliseModuleRecord(record).parameterisation).toBe('healthy')
  })
})
