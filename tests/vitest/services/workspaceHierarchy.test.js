import fs from 'node:fs'
import path from 'node:path'

import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { expandHierarchy } from '../../../src/services/hierarchy/expand.js'
import { buildWorkspaceFile, withoutHidden } from '../../../src/services/workspaceFile.js'
import { migrateWorkspace } from '../../../src/services/workspaceMigrator.js'
import { useInspectionModuleStore } from '../../../src/stores/inspectionModuleStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { useOmexStore } from '../../../src/stores/omexStore.js'
import { useSimulationSettingsStore } from '../../../src/stores/simulationSettingsStore.js'
import { PHLYNX_PROJECT_VERSION } from '../../../src/utils/constants.js'
import { modelOf, nestedGraph } from '../fixtures/hierarchy/saveFormat.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'
import { loadAndSave } from '../helpers/workspaceSave.js'

const NESTED_FIXTURE = path.resolve(process.cwd(), 'tests/resources/migration-versioning/v1-3-0/sn_nested.json')

/** Saves a flow with fresh stores, as a save writes it, and parses it back. */
function save(flow) {
  const sources = {
    library: useLibraryStore(),
    simulation: useSimulationSettingsStore(),
    inspectionModules: useInspectionModuleStore(),
    omex: useOmexStore(),
  }
  return JSON.parse(JSON.stringify(buildWorkspaceFile({ flow, ...sources })))
}

const hasHidden = (flow) => [...flow.nodes, ...flow.edges].some((item) => 'hidden' in item)

describe('saving and loading a nested workspace', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('keeps its super-modules, subsystems, overrides and exposure edges', () => {
    const flow = { ...nestedGraph(), viewport: { x: 0, y: 0, zoom: 1 } }
    const loaded = migrateWorkspace(save(flow))

    expect(loaded.version).toBe(PHLYNX_PROJECT_VERSION)
    expect(loaded.flow.nodes).toEqual(flow.nodes)
    expect(loaded.flow.edges).toEqual(flow.edges)
    const byId = new Map(loaded.flow.nodes.map((node) => [node.id, node]))
    expect(byId.get('sm_1')).toMatchObject({ type: 'subsystemInterface', deletable: false })
    expect(byId.get('sm_1').data.supermodule.localConstants).toEqual([{ name: 'g', units: 'dimensionless', value: '1', data_reference: null }])
    expect(byId.get('dndnode_1').data.overrides).toEqual({ a: { k: { value: '2' } }, '@': { g: { value: '3' } } })
    expect(loaded.flow.edges.find((edge) => edge.type === 'exposure').data).toEqual({ exposedPortId: 'xp_out' })
    expect(modelOf(loaded.flow)).toEqual(modelOf(flow))
  })

  it('saves no node or edge hidden, whatever the canvas shows', () => {
    const flow = nestedGraph()
    const shown = {
      nodes: flow.nodes.map((node) => ({ ...node, hidden: node.data.scope !== null })),
      edges: flow.edges.map((edge) => ({ ...edge, hidden: edge.id === 'sm_1~a--sm_1~b' })),
    }
    const saved = save(shown)
    expect(hasHidden(saved.flow)).toBe(false)
    expect(saved.flow).toEqual(save(flow).flow)
  })

  it('keeps a selection of a module inside a subsystem', () => {
    const simulation = useSimulationSettingsStore()
    const key = 'dndnode_1/b::k'
    simulation.setParameterScanConfig({ selections: [{ key, nodeId: 'dndnode_1/b', nodeName: 'p1__b', parameterName: 'k' }] })
    const loaded = migrateWorkspace(save(nestedGraph()))
    expect(loaded.simulation.parameterScanConfig.selections[0]).toMatchObject({ key, nodeId: 'dndnode_1/b' })
  })
})

describe('withoutHidden', () => {
  it('drops hidden from nodes and edges only, copying only what had it', () => {
    const shown = { id: 'n1', position: { x: 0, y: 0 } }
    const flow = { nodes: [shown, { id: 'n2', hidden: true }], edges: [{ id: 'e', hidden: false }], viewport: { zoom: 1 } }
    const stripped = withoutHidden(flow)
    expect(stripped).toEqual({ nodes: [shown, { id: 'n2' }], edges: [{ id: 'e' }], viewport: { zoom: 1 } })
    expect(stripped.nodes[0]).toBe(shown)
  })
})

describe('the nested 1.3.0 fixture', () => {
  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  const fixture = () => JSON.parse(fs.readFileSync(NESTED_FIXTURE, 'utf8'))

  it('expands to the SN chain it nests, under flat names and with its overrides', () => {
    const { nodes, edges } = migrateWorkspace(fixture()).flow
    const expansion = expandHierarchy(nodes, edges)

    expect(expansion.errors.filter((error) => error.severity === 'error')).toEqual([])
    expect(expansion.nodes.map((node) => [node.id, node.data.name])).toEqual([
      ['dndnode_3/dndnode_0/dndnode_0', 'neuron__body__soma'],
      ['dndnode_3/dndnode_1', 'neuron__axon'],
      ['dndnode_2', 'var_SN'],
    ])
    const valueOf = (id, name) => expansion.nodes.find((node) => node.id === id).data.variables.find((row) => row.name === name).value
    expect(valueOf('dndnode_3/dndnode_0/dndnode_0', 'Ko')).toBe('5')
    expect(valueOf('dndnode_3/dndnode_1', 'C')).toBe('1.2')
    const nameOf = (id) => expansion.nameOf(id)
    expect(expansion.edges.map((edge) => [nameOf(edge.source), nameOf(edge.target)])).toEqual([
      ['neuron__axon', 'var_SN'],
      ['neuron__body__soma', 'neuron__axon'],
    ])
  })

  it('loads and saves again unchanged, but for its stale hidden flags', () => {
    const doc = fixture()
    expect(hasHidden(doc.flow)).toBe(true)
    const saved = loadAndSave(doc)
    expect(hasHidden(saved.flow)).toBe(false)
    expect(saved.flow).toEqual(withoutHidden(doc.flow))
    expect(saved.store.availableSupermodules).toEqual([])
    expect(saved.simulation.simulationSettings.sweep).toEqual(doc.simulation.simulationSettings.sweep)
  })
})
