// @vitest-environment happy-dom
import fs from 'node:fs'
import path from 'node:path'

import JSZip from 'jszip'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const notified = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() }))
vi.mock('../../../src/utils/notify', () => ({ notify: notified }))

const { generateExportZip } = await import('../../../src/services/export/ca.js')
const { simulateCaPairing } = await import('../../../src/services/export/caSimulate.js')
const { useLibraryStore } = await import('../../../src/stores/libraryStore.js')
const { loadBundledLibrary } = await import('../fixtures/hierarchy/equivalence.js')
const { addGoldenMath, couplingMappings, goldenWorkspace, terminalWorkspace } = await import('../fixtures/ca/golden.js')
const { arrayFromExport } = await import('../fixtures/ca/workspace.js')

/**
 * Pairs a module array's slots as the simulator says CA does, as the variable mappings CA writes between modules: each
 * direct pair's variables, and the pressure CA's terminal rule maps from a terminal into a venous module.
 *
 * @param {string} arrayCsv
 * @param {Array} config
 * @returns {Array<string>} Sorted, as couplingMappings gives them.
 */
function simulatedMappings(arrayCsv, config) {
  const array = arrayFromExport(arrayCsv, config)
  const { pairs, terminals } = simulateCaPairing(array)
  const mappings = new Set()
  const add = (edge, from, to) => mappings.add([`${edge.source}_module.${from}`, `${edge.target}_module.${to}`].sort().join(' = '))
  for (const { edge, source, target, rule } of pairs) {
    if (rule) continue
    const [from, to] = [array.portsOf(edge.source)[source], array.portsOf(edge.target)[target]]
    for (let i = 0; i < Math.min(from.variables.length, to.variables.length); i++) add(edge, from.variables[i], to.variables[i])
  }
  // The terminal's flow goes through CA's terminal_venous_connection, not between the modules.
  for (const [edge, ruleMappings] of terminals) ruleMappings.filter(([from]) => from === 'u_out').forEach(([from, to]) => add(edge, from, to))
  return [...mappings].sort()
}

// Each workspace's CA export, and the mappings circulatory_autogen generated from it
// (scripts/ca-pairing/generate_ca_pairing_reference.py).
describe.each([
  { dir: 'pairing', build: goldenWorkspace, setUp: addGoldenMath, pairedDifferently: [] },
  // CA maps the terminal's pressure into venous modules only, which the export warns of.
  { dir: 'pairing-terminal', build: terminalWorkspace, setUp: () => {}, pairedDifferently: ['a_module.u = t_module.u_out', 'a_module.v_in = t_module.v_T'] },
])("circulatory_autogen's own pairing of the $dir workspace's export", ({ dir, build, setUp, pairedDifferently }) => {
  const read = (file) => fs.readFileSync(path.resolve(process.cwd(), 'tests/resources/ca', dir, file), 'utf8')
  const reference = JSON.parse(read('ca-connections.json'))
  let files
  let workspace
  let warnings

  beforeAll(async () => {
    await ensureLibCellmlReady()
    setActivePinia(createPinia())
    const library = useLibraryStore()
    loadBundledLibrary(library)
    setUp(library)
    workspace = build(library)
    notified.warning.mockClear()
    const zip = await JSZip.loadAsync(await (await generateExportZip('golden', workspace.nodes, workspace.edges, library)).arrayBuffer())
    files = Object.fromEntries(await Promise.all(Object.keys(zip.files).filter((name) => !zip.files[name].dir).map(async (name) => [name, await zip.file(name).async('string')])))
    warnings = notified.warning.mock.calls.map(([warning]) => warning).filter((warning) => warning.title === 'Connections Paired Differently')
  }, 120000)

  it('is of the export as it is now; otherwise regenerate it with the script', () => {
    expect(files['golden_module_array.csv']).toBe(read('golden_module_array.csv'))
    expect(JSON.parse(files['modules/golden_module_config.json'])).toEqual(JSON.parse(read('modules/golden_module_config.json')))
  })

  it("couples in CA the variables the workspace's couplings do, but for those the export warns of", () => {
    const wanted = couplingMappings(workspace)
    expect(wanted.filter((mapping) => !reference.mappings.includes(mapping))).toEqual(pairedDifferently)
    expect(reference.mappings.filter((mapping) => !wanted.includes(mapping))).toEqual([])
    expect(warnings).toHaveLength(pairedDifferently.length ? 1 : 0)
  })

  it('is what the simulator says CA does with that module array', () => {
    expect(simulatedMappings(read('golden_module_array.csv'), JSON.parse(read('modules/golden_module_config.json')))).toEqual(reference.mappings)
  })
})
