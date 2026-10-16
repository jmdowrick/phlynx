// @vitest-environment happy-dom
import { useVueFlow } from '@vue-flow/core'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/utils/notify', () => ({ notify: { warning: vi.fn(), error: vi.fn() } }))

const { useParameterContext } = await import('../../../src/composables/useParameterContext.js')
const { useCanvasLevel } = await import('../../../src/composables/useCanvasLevel.js')
const { useFlowHistoryStore } = await import('../../../src/stores/historyStore.js')
const { FLOW_IDS } = await import('../../../src/utils/constants.js')
const { connect, constant, exposed, exposures, module, port, superInstance, supermodule } = await import('../fixtures/hierarchy/graph.js')

const vessel = (localId, name, options = {}) =>
  module(localId, name, {
    ports: [port('entrance_ports', 'vessel', ['v_in']), port('exit_ports', 'vessel', ['v'])],
    variables: [constant('R', '1'), constant('C', '2')],
    ...options,
  })

/** Root a → leg, leg and arm super instances of limb (sm_1: art, its entrance exposed). */
function limbGraph() {
  const art = vessel('art', 'art', { scope: 'sm_1' })
  const limb = supermodule('sm_1', 'limb', { submoduleOrder: ['art'] })
  const exposure = exposures('sm_1', [exposed('xp_a', 'art', 'entrance_ports', 'vessel')])
  const store = { nodes: [limb, art], edges: exposure }
  const leg = superInstance(store, 'dndnode_1', 'leg', 'sm_1')
  const arm = superInstance(store, 'dndnode_2', 'arm', 'sm_1')
  const a = vessel('dndnode_0', 'a')
  return { nodes: [a, leg, arm, ...store.nodes], edges: [connect(a, leg, { id: 'e0' }), ...exposure] }
}

describe('useParameterContext', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  let level, context, history
  const art = () => flow.findNode('sm_1~art')
  const valueOf = (rows, name) => rows.find((row) => row.name === name).value

  beforeEach(async () => {
    setActivePinia(createPinia())
    history = useFlowHistoryStore()
    level = useCanvasLevel()
    level.reset()
    context = useParameterContext()
    flow.edges.value = []
    flow.nodes.value = []
    const { nodes, edges } = limbGraph()
    flow.addNodes(nodes)
    flow.addEdges(edges)
  })

  it('shows a root module’s own rows, with no provenance', () => {
    const a = flow.findNode('dndnode_0')
    expect(context.contextOf(a)).toEqual({ mode: 'root', modelId: 'dndnode_0' })
    expect(context.rowsOf(a)).toBe(a.data.variables)
    expect(context.provenanceOf(a).size).toBe(0)
  })

  it('edits inside a super instance as its override by default, one undo step, leaving its other copies', async () => {
    level.enter('dndnode_1')
    expect(context.contextOf(art())).toEqual({ mode: 'instance', modelId: 'dndnode_1/art' })
    expect(context.provenanceOf(art()).get('R').chip).toBe('default')

    context.writeRow(art(), 'R', { value: '9', type: 'constant' })
    expect(flow.findNode('dndnode_1').data.overrides).toEqual({ art: { R: { value: '9' } } })
    expect(valueOf(art().data.variables, 'R')).toBe('1')
    expect(valueOf(context.rowsOf(art()), 'R')).toBe('9')
    expect(context.provenanceOf(art()).get('R')).toMatchObject({ chip: 'overridden', inherited: '1' })

    await flushPromises()
    await history.undo()
    expect(flow.findNode('dndnode_1').data.overrides ?? {}).toEqual({})
    expect(valueOf(context.rowsOf(art()), 'R')).toBe('1')
  })

  it('writes the super-module’s default when asked, and resets an override', () => {
    level.enter('dndnode_1')
    context.writeRow(art(), 'C', { value: '7', type: 'constant' }, { target: 'supermodule' })
    expect(valueOf(art().data.variables, 'C')).toBe('7')
    expect(flow.findNode('dndnode_1').data.overrides ?? {}).toEqual({})

    context.writeRow(art(), 'R', { value: '9', type: 'constant' })
    context.resetRow(art(), 'R')
    expect(flow.findNode('dndnode_1').data.overrides).toEqual({})
    expect(context.provenanceOf(art()).get('R').chip).toBe('default')
  })

  it('edits a super-module edited on its own only as its default, and sums up its copies', () => {
    level.enter('dndnode_1')
    context.writeRow(art(), 'R', { value: '9', type: 'constant' })
    level.editSupermodule('sm_1')

    expect(context.contextOf(art())).toEqual({ mode: 'supermodule', modelId: 'sm_1~art' })
    expect(context.targetFor(art(), 'instance')).toBe('supermodule')
    expect(context.provenanceOf(art()).get('R')).toMatchObject({ total: 2, overridden: 1 })

    context.writeRow(art(), 'R', { value: '3', type: 'constant' }, { target: 'instance' })
    expect(valueOf(art().data.variables, 'R')).toBe('3')
  })
})
