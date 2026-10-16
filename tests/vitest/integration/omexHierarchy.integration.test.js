// @vitest-environment happy-dom
import JSZip from 'jszip'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateOmexArchive } from '../../../src/services/compress.js'
import { buildFlowSnapshot, restoreFlowSnapshot, SNAPSHOT_KIND } from '../../../src/services/flowSnapshot.js'
import { expandHierarchy } from '../../../src/services/hierarchy/expand.js'
import { importOmexFile } from '../../../src/services/import/omex.js'
import { buildScopedModel, resolveScope } from '../../../src/services/simulation/scopedModel.js'
import { compareCanonical } from '../../../src/services/testing/modelCompare.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { extractVoiAndParametersFromModel, loadParametersFromCellML } from '../../../src/utils/cellml.js'
import { loadBundledLibrary, moduleFactory, twoLevel } from '../fixtures/hierarchy/equivalence.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

// Exporting through libcellml takes seconds per test on CI.
vi.setConfig({ testTimeout: 120000 })

// The generated components' variables are named in the order edges are exported, so compare them by what they join.
const GENERATED = ['generated_summations', 'generated_multiplications']
const SETTINGS = { startingPoint: 0, endingPoint: 1, pointInterval: 0.1, solver: 'CVODE' }

describe('an OMEX archive of a nested workspace', () => {
  let store
  let make

  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    loadBundledLibrary(store)
    make = moduleFactory(store)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  /** The CellML of a run, of the whole model or of a scope of model ids, as an archive of it holds. */
  async function runModel({ nodes, edges }, nodeIds) {
    const model = expandHierarchy(nodes, edges)
    const scope = resolveScope(nodeIds, model.nodes, model.edges)
    return (await buildScopedModel(scope, store, { check: false })).text()
  }

  /** Writes a run's archive as export does, then reads its CellML and snapshot back as import does. */
  async function roundTrip(flow, nodeIds = null) {
    const cellml = await runModel(flow, nodeIds)
    const snapshot = JSON.stringify(buildFlowSnapshot(flow, { nodeIds, library: store }))
    const extractedData = extractVoiAndParametersFromModel(cellml, { selections: [] })
    const archive = await generateOmexArchive({ blob: new Blob([cellml]) }, snapshot, { simulationSettings: SETTINGS }, {
      cellmlFileName: 'model.cellml',
      extractedData,
    })

    const payload = await archive.arrayBuffer()
    const { files } = await importOmexFile(payload)
    const zip = await JSZip.loadAsync(payload)
    const read = (location) => zip.file(location).async('string')
    const archivedCellml = await read(files.cellml)
    const restored = restoreFlowSnapshot(JSON.parse(await read(files.flowSnapshot)), {
      parameterData: loadParametersFromCellML(archivedCellml).parameters,
    })
    return { cellml: archivedCellml, snapshot: JSON.parse(snapshot), restored }
  }

  it('restores the whole store from a hierarchical snapshot, its model as the archive’s CellML', async () => {
    const { nested } = twoLevel(make)
    const { cellml, snapshot, restored } = await roundTrip(nested)

    expect(snapshot.snapshotKind).toBe(SNAPSHOT_KIND.HIERARCHICAL)
    expect(restored.nodes.map((node) => [node.id, node.type])).toEqual(nested.nodes.map((node) => [node.id, node.type]))
    expect(restored.edges.map((edge) => edge.id)).toEqual(['e0', 'e1', 'sm_1~art--sm_1~bed'])
    for (const node of nested.nodes.filter((candidate) => candidate.type !== 'instanceNode')) {
      expect(restored.nodes.find((candidate) => candidate.id === node.id).data).toEqual(node.data)
    }
    expect(restored.nodeNameToIdMap.get('leg__bed__cap')).toBe('dndnode_1/bed/cap')
    expect(restored.nodeNameToIdMap.get('leg/bed/cap')).toBe('dndnode_1/bed/cap')
    expect(restored.nodeNameToIdMap.get('aorta')).toBe('dndnode_0')
    const result = compareCanonical(await runModel(restored), cellml, { nameByConnection: GENERATED })
    expect(result.differences).toEqual([])
  })

  it('restores part of the model from a flat snapshot, as root modules giving the archive’s CellML', async () => {
    const { nested } = twoLevel(make)
    const { cellml, snapshot, restored } = await roundTrip(nested, ['dndnode_1/art', 'dndnode_1/bed/cap'])

    expect(snapshot.snapshotKind).toBe(SNAPSHOT_KIND.FLAT)
    expect(restored.nodes.map((node) => [node.id, node.data.name, node.data.scope])).toEqual([
      ['dndnode_1_art', 'leg__art', null],
      ['dndnode_1_bed_cap', 'leg__bed__cap', null],
    ])
    expect(restored.edges.map((edge) => [edge.source, edge.target])).toEqual([['dndnode_1_art', 'dndnode_1_bed_cap']])
    const result = compareCanonical(await runModel(restored), cellml, { nameByConnection: GENERATED })
    expect(result.differences).toEqual([])
  })
})
