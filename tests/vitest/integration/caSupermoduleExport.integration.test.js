// @vitest-environment happy-dom
/**
 * The circulatory_autogen export of a workspace with super instances, flat (Mode A): the module array is CA's own
 * expansion of the module array the workspace was imported from, its names mapped from '__' to CA's '_' between
 * levels, and the parameters are the values CA would use. Imported again, the export gives back the flat model.
 */
import fs from 'node:fs'
import path from 'node:path'

import JSZip from 'jszip'
import Papa from 'papaparse'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { CA_ARRAY_FORMATS, generateExportZip } from '../../../src/services/export/ca.js'
import { expandHierarchy } from '../../../src/services/hierarchy/expand.js'
import { buildWorkflowGraph } from '../../../src/services/import/buildWorkflow.js'
import { buildCaModel, foldCaModel } from '../../../src/services/import/caFold.js'
import { looksLikeSupermoduleInstance, normaliseModuleRecords, toInstanceRows } from '../../../src/services/import/caModuleArray.js'
import { compareCanonical } from '../../../src/services/testing/modelCompare.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { generateFlattenedModel } from '../../../src/utils/cellml.js'
import { applyParametersToNodes } from '../../../src/utils/parameters.js'
import { libraryOf, loadCaLibrary, readCa, systemModel } from '../helpers/caLibrary.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

// Exporting through libcellml takes seconds per test on CI.
vi.setConfig({ testTimeout: 120000 })

const notified = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() }))
vi.mock('../../../src/utils/notify', () => ({ notify: notified }))

const EXPECTED = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../resources/ca-supermodules/expected.json'), 'utf8'))
// CA joins levels with '_' until CA#582.
const toCa = (name) => name.replace(/__/g, '_')

/** @returns {Promise<Object<string, string>>} A zip's text files by name. */
async function readZip(blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir)
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await zip.file(name).async('string')])))
}

const csvRows = (text) => Papa.parse(text, { header: true, skipEmptyLines: true }).data

/** A model's values by name: `name.variable` -> value. */
const valuesOf = (nodes) =>
  Object.fromEntries(nodes.flatMap((node) => (node.data.variables ?? []).map((row) => [`${node.data.name}.${row.name}`, row.value ?? null])))

describe.each([
  { name: '3compartment_supermodules', dir: 'system_models/closed_loop_cvs/3compartment_supermodules' },
  { name: 'SN_simple_supermodules', dir: 'system_models/cellular/SN_simple_supermodules' },
])('the flat circulatory_autogen export of $name, imported with super instances', ({ name, dir }) => {
  let store
  let load
  let configPaths
  let hostRows
  let expansion
  let files

  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  beforeEach(async () => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    ;({ load, configPaths } = loadCaLibrary(store))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const model = systemModel(dir)
    hostRows = model.hostRows
    const library = libraryOf(store)
    const built = buildCaModel(model.rows, library, { load, hostRows })
    for (const { name: global, value, units, data_reference } of built.globals) store.assignGlobalConstant(global, value, units, data_reference)
    const folded = foldCaModel(built, library, { load })
    expansion = expandHierarchy(folded.nodes, folded.edges)
    expect(expansion.errors.filter((error) => error.severity === 'error')).toEqual([])
    notified.warning.mockClear()
    files = await readZip(await generateExportZip(name, expansion.nodes, expansion.edges, store))
  })

  afterEach(() => vi.restoreAllMocks())

  it("writes as its module array CA's own expansion of the source, its records as components", () => {
    const expected = EXPECTED.library.find((entry) => entry.name === name).expected.records
    // The export orders each list so CA gives every connection the slots it has here, which it warns of otherwise.
    const asSets = ({ parameterisation: _parameterisation, ...record }, rename = (n) => n) => ({
      ...record,
      name: rename(record.name),
      inp_instances: record.inp_instances.map(rename).sort(),
      out_instances: record.out_instances.map(rename).sort(),
    })
    const records = JSON.parse(files[`${name}_module_array.json`]).map((record) => asSets(record, toCa))
    const byName = (list) => [...list].sort((a, b) => a.name.localeCompare(b.name))
    expect(byName(records)).toEqual(byName(expected.map((record) => asSets(record))))
    expect(notified.warning.mock.calls.map(([warning]) => warning.title)).not.toContain('Connections Paired Differently')
    // No super-module reaches CA: no record names one, and the config holds components only.
    const config = JSON.parse(files[`modules/${name}_module_config.json`])
    expect(config.filter((entry) => entry.module_format !== 'cellml')).toEqual([])
    expect(new Set(records.map((record) => `${record.module_type}:${record.module_subtype}`))).toEqual(
      new Set(config.map((entry) => `${entry.module_type}:${entry.module_subtype}`))
    )
  })

  it("writes back each module config's keys PhLynx doesn't read, as the library's file has them", () => {
    const read = new Set(['module_type', 'module_subtype', 'module_format', 'component_file', 'component_type', 'entrance_ports', 'exit_ports', 'general_ports', 'variables_and_units'])
    const config = JSON.parse(files[`modules/${name}_module_config.json`])
    for (const entry of config) {
      const ref = `${entry.module_type}:${entry.module_subtype}`
      const source = JSON.parse(readCa(configPaths.get(ref))).find((e) => `${e.module_type}:${e.module_subtype}` === ref)
      const extras = Object.fromEntries(Object.entries(source).filter(([key]) => !read.has(key)))
      expect({ ref, ...Object.fromEntries(Object.entries(entry).filter(([key]) => !read.has(key))) }).toEqual({ ref, ...extras })
    }
    expect(config.some((entry) => entry.licence && entry.creator && entry.default_parameterisation)).toBe(true)
  })

  it("names each parameter by its module's flat name, with the value CA would use", () => {
    const { parameter_rows: defaults } = EXPECTED.library.find((entry) => entry.name === name).expected
    // CA takes the host file's row first, then the defaults the expansion gives.
    const caValues = new Map()
    for (const row of [...hostRows, ...defaults]) {
      if (!caValues.has(row.variable_name.trim())) caValues.set(row.variable_name.trim(), row.value)
    }
    const exported = csvRows(files[`${name}_parameters.csv`])
    expect(exported.filter((row) => row.variable_name.includes('/'))).toEqual([])
    const names = new Set(exported.map((row) => toCa(row.variable_name)))
    // Every value CA has for a variable of the model is written, under the name CA gives it; the rest are the modules'
    // own defaults. The host file also sets r_0 and l, which no module has.
    const variables = new Set(expansion.nodes.flatMap((node) => node.data.variables.map((row) => toCa(`${row.name}_${node.data.name}`))))
    const isOfModel = (key) => variables.has(key) || [...store.globalVariables].some(([global]) => global === key)
    expect([...caValues.keys()].filter((key) => isOfModel(key) && !names.has(key))).toEqual([])
    const mismatched = exported
      .map((row) => [toCa(row.variable_name), row.value, caValues.get(toCa(row.variable_name))])
      .filter(([, value, ca]) => ca !== undefined && Number(value) !== Number(ca))
    expect(mismatched).toEqual([])
  })

  it('is written to the legacy CSV with the same records', async () => {
    const csv = await readZip(await generateExportZip(name, expansion.nodes, expansion.edges, store, null, { arrayFormat: CA_ARRAY_FORMATS.CSV }))
    const joined = JSON.parse(files[`${name}_module_array.json`]).map((record) => ({
      ...record,
      inp_instances: record.inp_instances.join(' '),
      out_instances: record.out_instances.join(' '),
    }))
    expect(csvRows(csv[`${name}_module_array.csv`]).map((row) => ({ ...row }))).toEqual(
      joined.map(({ name: n, module_type, module_subtype, inp_instances, out_instances }) => ({ name: n, module_subtype, module_type, inp_instances, out_instances }))
    )
    for (const file of Object.keys(files).filter((file) => !file.endsWith('_module_array.json'))) expect(csv[file]).toBe(files[file])
  })

  it('gives back the flat model when imported again, records, values and CellML', async () => {
    // As the import reads a flat module array: its rows built, then the parameters file applied.
    const rows = toInstanceRows(normaliseModuleRecords(JSON.parse(files[`${name}_module_array.json`]), `${name}_module_array.json`))
    expect(rows.filter((row) => store.availableSupermodules.has(`${row.module_type}:${row.module_subtype}`) || looksLikeSupermoduleInstance(row))).toEqual([])
    const graph = buildWorkflowGraph(rows, store.availableModules, store.getMathAnalysis, [], null, store.getMathDefaults, {
      caRules: true,
      variants: store.caVariants,
    })
    const { variablesById, skipped } = applyParametersToNodes(graph.pendingInstances, csvRows(files[`${name}_parameters.csv`]))
    expect(skipped).toEqual([])
    const again = {
      nodes: graph.pendingInstances.map((node) => ({ ...node, data: { ...node.data, variables: variablesById.get(node.id) ?? node.data.variables } })),
      edges: graph.pendingEdges,
    }
    expect(graph.conflicts).toEqual([])
    expect(again.nodes.map((node) => [node.data.name, node.data.moduleRef]).sort()).toEqual(
      expansion.nodes.map((node) => [node.data.name, node.data.moduleRef]).sort()
    )
    expect(valuesOf(again.nodes)).toEqual(valuesOf(expansion.nodes))
    const exportOf = async ({ nodes, edges }) => (await generateFlattenedModel(nodes, edges, store, [], { check: false, allowBcOnly: true })).text()
    const result = compareCanonical(await exportOf(again), await exportOf(expansion))
    expect(result.differences).toEqual([])
  })
})
