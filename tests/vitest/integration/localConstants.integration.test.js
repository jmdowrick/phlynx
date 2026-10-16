// @vitest-environment happy-dom
/**
 * Local constants (#445) export as the flat models they stand for: flat CellML has one constant per super instance,
 * connected to every row bound to it, and simulates as a hand-flat model with a constant per row; circulatory_autogen
 * writes a row per bound row, flat and natively.
 */
import createLibOpenCOR from '@opencor/libopencor'
import JSZip from 'jszip'
import Papa from 'papaparse'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateExportZip } from '../../../src/services/export/ca.js'
import { expandHierarchy } from '../../../src/services/hierarchy/expand.js'
import { planRetypeBinding } from '../../../src/services/hierarchy/localConstants.js'
import { canonicalModel, compareCanonical, compareSimulations } from '../../../src/services/testing/modelCompare.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { generateFlattenedModel } from '../../../src/utils/cellml.js'
import { PHLYNX_INSTANCE_PARAMETERS_COMPONENT_NAME } from '../../../src/utils/constants.js'
import { named } from '../fixtures/ca/native.js'
import { loadBundledLibrary, localConstantBranches, localConstantSegments, moduleFactory } from '../fixtures/hierarchy/equivalence.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

vi.setConfig({ testTimeout: 120000 })

const notified = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() }))
vi.mock('../../../src/utils/notify', () => ({ notify: notified }))

const GENERATED = ['generated_summations', 'generated_multiplications']
const PARAMETERS = PHLYNX_INSTANCE_PARAMETERS_COMPONENT_NAME

/**
 * Takes the instance parameters out of a canonical model: each module variable connected to one gets its value, and
 * the connections to it go, so one constant shared by two rows reads as two of the same value.
 *
 * @returns {{canon: Object, values: Object<string, string>}}
 */
function withoutParameters(canon) {
  const parameters = canon.components[PARAMETERS]?.variables ?? {}
  const values = {}
  const equivalences = []
  for (const set of canon.equivalences) {
    const parameter = set.find((member) => member.startsWith(`${PARAMETERS}/`))
    if (!parameter) {
      equivalences.push(set)
      continue
    }
    const others = set.filter((member) => !member.startsWith(`${PARAMETERS}/`))
    for (const member of others) values[member] = parameters[parameter.slice(PARAMETERS.length + 1)].initialValue
  }
  const { [PARAMETERS]: _parameters, ...components } = canon.components
  return { canon: { ...canon, components, equivalences: equivalences.sort() }, values }
}

async function readZip(blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir)
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await zip.file(name).async('string')])))
}
const csvValues = (text) => new Map(Papa.parse(text, { header: true, skipEmptyLines: true }).data.map((row) => [row.variable_name, row.value]))

describe('local constants in flat CellML', () => {
  let store
  let libOpenCOR

  beforeAll(async () => {
    await ensureLibCellmlReady()
    libOpenCOR = await createLibOpenCOR()
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it('emits each super instance’s once, connected to its rows, and means what a constant per row does', async () => {
    const { nested, flat } = localConstantBranches(store)
    const expansion = expandHierarchy(nested.nodes, nested.edges)
    expect(expansion.errors).toEqual([])
    const exported = await (await generateFlattenedModel(expansion.nodes, expansion.edges, store)).text()
    const handFlat = await (await generateFlattenedModel(flat.nodes, flat.edges, store)).text()

    const canon = canonicalModel(exported, { nameByConnection: GENERATED })
    expect(canon.components[PARAMETERS].variables).toMatchObject({
      k_b1: { initialValue: '0.25', units: 'per_second' },
      k_b2: { initialValue: '0.125', units: 'per_second' },
    })
    expect(canon.equivalences).toEqual(
      expect.arrayContaining([
        ['b1__l1/k', 'b1__l2/k', `${PARAMETERS}/k_b1`],
        ['b2__l1/k', 'b2__l2/k', `${PARAMETERS}/k_b2`],
      ])
    )

    const a = withoutParameters(canon)
    const b = withoutParameters(canonicalModel(handFlat, { nameByConnection: GENERATED }))
    expect(a.values).toEqual(b.values)
    expect(a.values).toMatchObject({ 'b1__l1/k': '0.25', 'b1__l2/k': '0.25', 'b2__l1/k': '0.125', 'b2__l2/k': '0.125' })
    expect(compareCanonical(a.canon, b.canon).differences).toEqual([])

    const result = await compareSimulations(exported, handFlat, { module: libOpenCOR, endTime: 2 })
    expect(result.details.missing).toEqual([])
    expect(result.equal).toBe(true)
  })

  it('takes the declared value where a super instance overrides nothing', async () => {
    const { nested } = localConstantBranches(store)
    nested.nodes.find((node) => node.id === 'dndnode_2').data.overrides = {}
    const expansion = expandHierarchy(nested.nodes, nested.edges)
    const canon = canonicalModel(await (await generateFlattenedModel(expansion.nodes, expansion.edges, store)).text(), { nameByConnection: GENERATED })
    expect(canon.components[PARAMETERS].variables.k_b2.initialValue).toBe('0.5')
  })
})

describe('local constants in circulatory_autogen', () => {
  let store
  let make

  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    loadBundledLibrary(store)
    make = moduleFactory(store)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    notified.info.mockClear()
  })

  afterEach(() => vi.restoreAllMocks())

  it('writes flat a row per bound row, each with its super instance’s value, as the hand-flat model does', async () => {
    const { nested, flat } = localConstantSegments(make)
    const expansion = expandHierarchy(nested.nodes, nested.edges)
    expect(expansion.errors).toEqual([])
    const files = await readZip(await generateExportZip('m', expansion.nodes, expansion.edges, store))
    const handFlat = await readZip(await generateExportZip('m', flat.nodes, flat.edges, store))
    const values = csvValues(files['m_parameters.csv'])
    expect(['R_seg1__a', 'R_seg1__b', 'R_seg2__a', 'R_seg2__b'].map((name) => values.get(name))).toEqual(['2', '2', '3', '3'])
    expect(values).toEqual(csvValues(handFlat['m_parameters.csv']))
    // CA has no local constant type: the module config is the library's.
    expect(files['modules/m_module_config.json']).toBe(handFlat['modules/m_module_config.json'])
    expect(files['modules/m_module_config.json']).not.toContain('local_constant')
  })

  it('writes natively the declared value as the super-module’s rows, and each override as host rows', async () => {
    const { nested } = localConstantSegments(make)
    named(nested.nodes.find((node) => node.id === 'sm_1'), 'segment')
    const expansion = expandHierarchy(nested.nodes, nested.edges)
    const files = await readZip(await generateExportZip('m', expansion.nodes, expansion.edges, store, null, { hierarchy: nested }))
    expect(notified.info.mock.calls.map(([note]) => note.title)).not.toContain('Super-modules Written Flat')
    expect(JSON.parse(files['m_module_array.json']).map((record) => record.name)).toEqual(['seg1', 'seg2'])
    const defaults = csvValues(files['supermodules/segment/versions/phlynx_v1/parameterisations/default/default_parameters.csv'])
    expect([defaults.get('a/R'), defaults.get('b/R')]).toEqual(['3', '3'])
    const host = csvValues(files['m_parameters.csv'])
    expect([host.get('seg1/a/R'), host.get('seg1/b/R')]).toEqual(['2', '2'])
    expect(host.has('seg2/a/R')).toBe(false)
  })

  it('writes natively no host row for an override that binding its row left inert', async () => {
    const { nested } = localConstantSegments(make)
    named(nested.nodes.find((node) => node.id === 'sm_1'), 'segment')
    const a = nested.nodes.find((node) => node.id === 'sm_1~a')
    const bound = a.data.variables
    a.data.variables = bound.map((row) => (row.name === 'R' ? { ...row, type: 'constant' } : row))
    const seg1 = nested.nodes.find((node) => node.id === 'dndnode_0')
    seg1.data.overrides = { ...seg1.data.overrides, a: { R: { value: '9' } } }
    nested.nodes.find((node) => node.id === 'dndnode_1').data.overrides = { a: { R: { value: '7' } } }

    const { changes, count } = planRetypeBinding(nested.nodes, a, bound)
    expect(count).toBe(2)
    a.data.variables = bound
    for (const [id, fields] of changes) Object.assign(nested.nodes.find((node) => node.id === id).data, fields)

    const expansion = expandHierarchy(nested.nodes, nested.edges)
    const files = await readZip(await generateExportZip('m', expansion.nodes, expansion.edges, store, null, { hierarchy: nested }))
    const rows = Papa.parse(files['m_parameters.csv'], { header: true, skipEmptyLines: true }).data
    expect(rows.map((row) => [row.variable_name, row.value])).toEqual([
      ['seg1/a/R', '2'],
      ['seg1/b/R', '2'],
    ])
  })
})
