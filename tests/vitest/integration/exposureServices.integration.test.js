// @vitest-environment happy-dom
/**
 * Nested models built as the canvas builds them, through its services: a new super instance, modules dropped inside, a
 * child connected to the interface and its ports picked in the Expose Ports dialog, super instances connected at the
 * parent level, and values set for one super instance. Each must export as the hand-built flat graph it stands for.
 */
import { useVueFlow } from '@vue-flow/core'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCanvasLevel } from '../../../src/composables/useCanvasLevel.js'
import { useConnect } from '../../../src/composables/useConnect.js'
import { useExposure } from '../../../src/composables/useExposure.js'
import { useFlowHistory } from '../../../src/composables/useFlowHistory.js'
import { useModelGraph } from '../../../src/composables/useModelGraph.js'
import { useModelWriter } from '../../../src/composables/useModelWriter.js'
import { useSupermodules } from '../../../src/composables/useSupermodules.js'
import { useActiveCanvas } from '../../../src/composables/useActiveCanvas.js'
import { compareCanonical } from '../../../src/services/testing/modelCompare.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { generateFlattenedModel } from '../../../src/utils/cellml.js'
import { FLOW_IDS } from '../../../src/utils/constants.js'
import { splitNodeId } from '../../../src/utils/hierarchy.js'
import { loadBundledLibrary, moduleFactory, threeInstances, twoLevel } from '../fixtures/hierarchy/equivalence.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

// Exporting through libcellml takes seconds per test on CI.
vi.setConfig({ testTimeout: 120000 })

vi.mock('../../../src/utils/notify', () => ({ notify: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() } }))

// The generated components' variables are named in the order edges are exported, so compare them by what they join.
const GENERATED = ['generated_summations', 'generated_multiplications']

/** Each edge as its modules' names and its couplings' ports, slots and variables, sorted. */
function couplingsOf({ nodes, edges }) {
  const nameOf = new Map(nodes.map((node) => [node.id, node.data.name]))
  const end = (port, slot) => `${port.portType}:${port.label}:${slot}[${port.variables}|${port.multiportType}]`
  return edges
    .map((edge) => {
      const couplings = edge.data.couplings.map((c) => `${end(c.sourcePort, c.sourceSlot)} > ${end(c.targetPort, c.targetSlot)}`)
      return `${nameOf.get(edge.source)} > ${nameOf.get(edge.target)}: ${couplings.sort().join(', ')}`
    })
    .sort()
}

describe('a nested model built through the canvas’s services exports as its flat graph', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const level = useCanvasLevel()
  const canvas = useActiveCanvas()
  let store, make, history, listeners, exposure, supermodules, writer, exposureEdges

  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  beforeEach(async () => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    loadBundledLibrary(store)
    make = moduleFactory(store)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    history = useFlowHistoryStore()
    flow.applyDefault.value = false
    const { onNodeChange, onEdgeChange } = useFlowHistory({
      suppressedEdgeIds: new Set(),
      indexAddEdge: vi.fn(),
      indexRemoveEdge: vi.fn(),
      updateHelperLines: vi.fn(),
      revertHandlesForEdge: vi.fn(),
      reactivateEdgeHandles: vi.fn(),
    })
    listeners = [flow.onNodesChange(onNodeChange), flow.onEdgesChange(onEdgeChange)]
    level.reset()
    await flow.fromObject({ nodes: [], edges: [] })
    exposure = useExposure({ history })
    supermodules = useSupermodules()
    writer = useModelWriter()
    exposureEdges = []
    useConnect({
      suppressedEdgeIds: new Set(),
      confirm: vi.fn(async () => true),
      edgeLineOptions: { type: 'smoothstep' },
      confirmActivation: vi.fn(),
      activateHandle: vi.fn(),
      revertHandleIfUnused: vi.fn(),
      revertHandlesForEdge: vi.fn(),
      reactivateEdgeHandles: vi.fn(),
      onExposureEdge: (id) => exposureEdges.push(id),
    })
  })

  afterEach(() => {
    listeners.forEach((listener) => listener.off())
    flow.applyDefault.value = true
    vi.restoreAllMocks()
  })

  /** Drops a bundled module on the canvas, as a drop does: the next id in the scope shown. */
  function drop(name, moduleRef) {
    const id = canvas.nextNodeId()
    flow.addNodes(make(splitNodeId(id).localId, name, moduleRef, { scope: canvas.scope.value }))
    return id
  }

  /** Draws a connection between two nodes' handles, as the canvas does. */
  async function draw(source, target) {
    flow.emits.connect({ source, target, sourceHandle: `handle_${source}_out`, targetHandle: `handle_${target}_in` })
    await nextTick()
  }

  /** Connects a child to the interface shown and ticks the ports whose keys match, as the Expose Ports dialog does. */
  async function expose(childId, matches) {
    await draw(childId, canvas.scope.value)
    const edgeId = exposureEdges.at(-1)
    const { rows } = exposure.exposureDialogOf(edgeId)
    const picked = rows.filter(matches).map((row) => ({ key: row.key }))
    expect(picked.length).toBeGreaterThan(0)
    expect((await exposure.saveExposure(edgeId, picked)).saved).toBe(true)
    return edgeId
  }
  const vesselPort = (row) => row.port.label === 'vessel_port'

  async function compare(flat) {
    await nextTick()
    const expansion = useModelGraph().graph.value
    expect(expansion.errors).toEqual([])
    expect(expansion.nodes.map((node) => node.data.name).sort()).toEqual(flat.nodes.map((node) => node.data.name).sort())
    expect(couplingsOf(expansion)).toEqual(couplingsOf(flat))
    const exportOf = async ({ nodes, edges }) => (await generateFlattenedModel(nodes, edges, store, [], { check: false })).text()
    const result = compareCanonical(await exportOf(expansion), await exportOf(flat), { nameByConnection: GENERATED })
    expect(result.differences).toEqual([])
    expect(result.equal).toBe(true)
  }

  it('one super-module three times, each with its own values', async () => {
    const { smId, superInstanceId: seg1 } = supermodules.createEmptySuperModule('seg1', { x: 0, y: 0 })
    level.enter(seg1)
    const a = drop('a', 'arterial_simple:vp')
    await expose(a, vesselPort)
    level.exitTo(0)
    const seg2 = supermodules.addSuperInstance(smId, { x: 1, y: 0 })
    const seg3 = supermodules.addSuperInstance(smId, { x: 2, y: 0 })
    flow.updateNodeData(seg2, { name: 'seg2' })
    flow.updateNodeData(seg3, { name: 'seg3' })
    await draw(seg1, seg2)
    await draw(seg2, seg3)
    const localA = splitNodeId(a).localId
    ;[seg1, seg2, seg3].forEach((id, i) => writer.writeValue(`${id}/${localA}`, 'R', { value: ['2', '3', '5'][i] }))

    await compare(threeInstances(make).flat)
  })

  it('keeps its flat graph through a super-module edit, a reset, an un-expose and their undo and redo', async () => {
    const { smId, superInstanceId: seg1 } = supermodules.createEmptySuperModule('seg1', { x: 0, y: 0 })
    level.enter(seg1)
    const a = drop('a', 'arterial_simple:vp')
    await expose(a, vesselPort)
    level.exitTo(0)
    const seg2 = supermodules.addSuperInstance(smId, { x: 1, y: 0 })
    const seg3 = supermodules.addSuperInstance(smId, { x: 2, y: 0 })
    flow.updateNodeData(seg2, { name: 'seg2' })
    flow.updateNodeData(seg3, { name: 'seg3' })
    await draw(seg1, seg2)
    await draw(seg2, seg3)
    const localA = splitNodeId(a).localId
    ;[seg1, seg2, seg3].forEach((id, i) => writer.writeValue(`${id}/${localA}`, 'R', { value: ['2', '3', '5'][i] }))
    const { flat } = threeInstances(make)
    const withR = (values) => ({
      ...flat,
      nodes: flat.nodes.map((node, i) => ({
        ...node,
        data: { ...node.data, variables: node.data.variables.map((row) => (row.name === 'R' ? { ...row, value: values[i] } : row)) },
      })),
    })

    // The super-module's default is shadowed by every override until one is reset.
    writer.writeValue(`${seg2}/${localA}`, 'R', { value: '11' }, { target: 'supermodule' })
    await compare(flat)
    writer.resetOverride(`${seg2}/${localA}`, 'R')
    const edited = withR(['2', '11', '5'])
    await compare(edited)

    const outlet = supermodules.exposedPortsOf(smId).find((port) => port.alias.portType === 'exit_ports')
    const confirm = vi.fn(async () => true)
    expect(await exposure.unexposePorts(smId, [outlet.id], { confirm })).toBe(true)
    expect(confirm.mock.calls[0][0].message).toContain('2 connections in 2 super instances')
    await compare({ ...edited, edges: [] })
    await history.undo()
    await compare(edited)
    await history.redo()
    await compare({ ...edited, edges: [] })
    await history.undo()
    await compare(edited)
  })

  it('two levels, the outer exposing the inner’s outlet through via', async () => {
    const { superInstanceId: leg } = supermodules.createEmptySuperModule('leg', { x: 0, y: 0 })
    level.enter(leg)
    const art = drop('art', 'arterial_simple:pv')
    const { superInstanceId: bed } = supermodules.createEmptySuperModule('bed', { x: 1, y: 0 })
    level.enter(bed)
    const cap = drop('cap', 'terminal:pp')
    await expose(cap, vesselPort)
    level.exitTo(1)
    expect(flow.findNode(bed).data.ports.map((port) => port.portType)).toEqual(['entrance_ports', 'exit_ports'])
    await draw(art, bed)
    await expose(art, (row) => vesselPort(row) && row.port.portType === 'entrance_ports')
    await expose(bed, (row) => row.port.portType === 'exit_ports')
    level.exitTo(0)
    const aorta = drop('aorta', 'arterial_simple:pv')
    const vc = drop('vc', 'venous:vp')
    await draw(aorta, leg)
    await draw(leg, vc)
    const local = (id) => splitNodeId(id).localId
    writer.writeValue(`${leg}/${local(bed)}/${local(cap)}`, 'R_T', { value: '3' })
    writer.writeValue(`${leg}/${local(art)}`, 'R', { value: '4' })

    await compare(twoLevel(make).flat)
  })
})
