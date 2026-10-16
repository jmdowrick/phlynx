// @vitest-environment happy-dom
import { useVueFlow } from '@vue-flow/core'
import { computed, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useActiveCanvas } from '../../../src/composables/useActiveCanvas.js'
import { FLOW_IDS } from '../../../src/utils/constants.js'
import { connect, exposed, module, port, subsystem, supermodule } from '../fixtures/hierarchy/graph.js'

// Flows stubbed by id, as other suites stub Vue Flow; the rest are Vue Flow's own.
const stubs = vi.hoisted(() => new Map())
vi.mock('@vue-flow/core', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useVueFlow: (id) => stubs.get(id) ?? actual.useVueFlow(id) }
})

const IN = port('entrance_ports', 'vessel', ['v_in', 'u'])
const OUT = port('exit_ports', 'vessel', ['v', 'u_out'])
const vessel = (localId, name, options = {}) => module(localId, name, { ports: [{ ...IN }, { ...OUT }], ...options })

/** Root dndnode_0 → dndnode_1 → dndnode_2. */
function flatGraph() {
  const [a, b, c] = [vessel('dndnode_0', 'a'), vessel('dndnode_1', 'b'), vessel('dndnode_2', 'c')]
  const used = new Set()
  return { nodes: [a, b, c], edges: [connect(a, b, { used, id: 'e0' }), connect(b, c, { used, id: 'e1' })] }
}

/** Root a → heart (sm_1: ra → lv) → b. */
function heartGraph() {
  const ra = vessel('dndnode_7', 'ra', { scope: 'sm_1' })
  const lv = vessel('dndnode_8', 'lv', { scope: 'sm_1' })
  const sm = supermodule('sm_1', 'heart', {
    submoduleOrder: ['dndnode_7', 'dndnode_8'],
    exposedPorts: [exposed('xp_in', 'dndnode_7', 'entrance_ports', 'vessel'), exposed('xp_out', 'dndnode_8', 'exit_ports', 'vessel')],
  })
  const inner = [sm, ra, lv]
  const heart = subsystem(inner, 'dndnode_1', 'heart', 'sm_1')
  const a = vessel('dndnode_0', 'a')
  const b = vessel('dndnode_2', 'b')
  const used = new Set()
  const edges = [connect(a, heart, { used, id: 'e_in' }), connect(heart, b, { used, id: 'e_out' }), connect(ra, lv, { id: 'e_int' })]
  return { nodes: [a, heart, b, ...inner], edges }
}

describe('useActiveCanvas', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const { scope, nodes, edges, selectedNodes, selectedEdges, findNode, nextNodeId } = useActiveCanvas()
  const ids = (items) => items.map((item) => item.id)

  /** Puts a graph in the workspace's store. */
  const show = (graph) => {
    flow.nodes.value = []
    flow.edges.value = []
    flow.addNodes(graph.nodes)
    flow.addEdges(graph.edges)
  }

  beforeEach(() => show({ nodes: [], edges: [] }))
  afterEach(() => (scope.value = null))

  it('shows the root, one scope for every caller', () => {
    expect(scope.value).toBeNull()
    expect(useActiveCanvas().scope).toBe(scope)
  })

  it('is the whole store without super-modules: its own nodes and edges, and selection', () => {
    show(flatGraph())
    expect(nodes.value).toBe(flow.nodes.value)
    expect(edges.value).toBe(flow.edges.value)
    expect(findNode('dndnode_1')).toBe(flow.findNode('dndnode_1'))
    expect(nextNodeId()).toBe('dndnode_3')

    flow.findNode('dndnode_2').selected = true
    flow.findEdge('e1').selected = true
    expect(ids(selectedNodes.value)).toEqual(['dndnode_2'])
    expect(ids(selectedEdges.value)).toEqual(['e1'])
  })

  it('leaves out what is inside super-modules: their nodes, interfaces and edges', () => {
    show(heartGraph())
    expect(ids(nodes.value)).toEqual(['dndnode_0', 'dndnode_1', 'dndnode_2'])
    expect(ids(edges.value)).toEqual(['e_in', 'e_out'])
    expect(findNode('sm_1~dndnode_7')).toBeUndefined()
    expect(findNode('sm_1')).toBeUndefined()
    expect(nextNodeId()).toBe('dndnode_3')
  })

  it('selects only what it shows, though Vue Flow’s selection takes in nodes off it', () => {
    show(heartGraph())
    flow.nodes.value.forEach((node) => (node.selected = true))
    flow.edges.value.forEach((edge) => (edge.selected = true))
    expect(flow.getSelectedNodes.value).toHaveLength(6)
    expect(ids(selectedNodes.value)).toEqual(['dndnode_0', 'dndnode_1', 'dndnode_2'])
    expect(ids(selectedEdges.value)).toEqual(['e_in', 'e_out'])
  })

  it('shows a super-module’s scope when it is set', () => {
    show(heartGraph())
    scope.value = 'sm_1'
    expect(ids(nodes.value)).toEqual(['sm_1', 'sm_1~dndnode_7', 'sm_1~dndnode_8'])
    expect(ids(edges.value)).toEqual(['e_int'])
    expect(findNode('dndnode_0')).toBeUndefined()
    expect(nextNodeId()).toBe('sm_1~dndnode_9')
  })

  it('keeps a scope for each flow, showing that flow’s nodes', () => {
    show(flatGraph())
    const macro = useVueFlow(FLOW_IDS.MACRO)
    macro.addNodes([vessel('dndnode_0', 'm')])
    const canvas = useActiveCanvas(FLOW_IDS.MACRO)
    expect(canvas.scope).not.toBe(scope)
    scope.value = 'sm_1'
    expect(canvas.scope.value).toBeNull()
    expect(ids(canvas.nodes.value)).toEqual(['dndnode_0'])
    expect(canvas.nodes.value[0].data.name).toBe('m')
    macro.nodes.value = []
  })

  it('reads a stubbed flow’s getters, or nothing from a flow without them', () => {
    const [a, b] = [vessel('dndnode_0', 'a'), vessel('dndnode_1', 'b')]
    const stubNodes = ref([a, b])
    const stubEdges = ref([{ id: 'e0', source: a.id, target: b.id }])
    stubs.set('getters', {
      getNodes: computed(() => stubNodes.value),
      getEdges: computed(() => stubEdges.value),
      getSelectedNodes: computed(() => [a]),
    })
    stubs.set('bare', {})
    try {
      const stubbed = useActiveCanvas('getters')
      expect(stubbed.nodes.value).toBe(stubNodes.value)
      expect(stubbed.edges.value).toBe(stubEdges.value)
      expect(ids(stubbed.selectedNodes.value)).toEqual(['dndnode_0'])
      expect(stubbed.findNode('dndnode_1')).toBe(stubNodes.value[1])

      const bare = useActiveCanvas('bare')
      expect(bare.nodes.value).toEqual([])
      expect(bare.edges.value).toEqual([])
      expect(bare.selectedNodes.value).toEqual([])
      expect(bare.selectedEdges.value).toEqual([])
      expect(bare.findNode('dndnode_0')).toBeUndefined()
      expect(bare.nextNodeId()).toBe('dndnode_0')
    } finally {
      stubs.clear()
    }
  })
})
