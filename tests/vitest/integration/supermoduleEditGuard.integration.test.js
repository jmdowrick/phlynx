// @vitest-environment happy-dom
/**
 * The first structural edit inside a shared or library super-module asks first, whichever way it is made: dropping,
 * pasting, deleting, connecting, removing an edge, changing couplings, replacing a module, exposing ports, nesting and un-nesting. Change
 * all keeps it, one undo step; Make this one a new super-module gives the super instance its own; Cancel leaves no
 * edit and no step. The answer holds until the canvas leaves the super instance. Value edits and edits from the
 * library never ask.
 */
import { useVueFlow } from '@vue-flow/core'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/utils/notify', () => ({ notify: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() } }))

const { default: SupermoduleEditDialog } = await import('../../../src/components/dialogs/SupermoduleEditDialog.vue')
const { useCanvasDelete } = await import('../../../src/composables/useCanvasDelete.js')
const { useCanvasLevel } = await import('../../../src/composables/useCanvasLevel.js')
const { useConnect } = await import('../../../src/composables/useConnect.js')
const { default: useDragAndDrop } = await import('../../../src/composables/useDnD.js')
const { useExposure } = await import('../../../src/composables/useExposure.js')
const { useFlowHistory } = await import('../../../src/composables/useFlowHistory.js')
const { useHierarchyOperations } = await import('../../../src/composables/useHierarchyOperations.js')
const { useNodeDataHistory } = await import('../../../src/composables/useNodeDataHistory.js')
const { useSupermoduleEditGuard } = await import('../../../src/composables/useSupermoduleEditGuard.js')
const { useWorkspaceClipboard } = await import('../../../src/composables/useWorkspaceClipboard.js')
const { useFlowHistoryStore } = await import('../../../src/stores/historyStore.js')
const { EXPOSURE_EDGE_TYPE, FLOW_IDS } = await import('../../../src/utils/constants.js')
const { connect, exposed, exposures, module, port, subsystem, supermodule } = await import('../fixtures/hierarchy/graph.js')

const IN = port('entrance_ports', 'vessel', ['v_in'])
const OUT = port('exit_ports', 'vessel', ['v'])
const vessel = (localId, name, options = {}) => module(localId, name, { ports: [{ ...IN }, { ...OUT }], ...options })

/**
 * Root: h1 and h2, super instances of heart (sm_1: a → b, c unconnected with an exposure edge exposing nothing, and
 * lv, a super instance of chamber, sm_2, holding wall), exposing a's entrance; solo, the one super instance of
 * single (sm_3, holding x); and lib1, the one super instance of lib (sm_4, from the library, holding y).
 */
function graph() {
  const wall = vessel('w', 'wall', { scope: 'sm_2' })
  const chamber = supermodule('sm_2', 'chamber')
  const lv = subsystem([chamber, wall], 'lv', 'lv', 'sm_2', { scope: 'sm_1' })
  const [a, b, c] = ['a', 'b', 'c'].map((id) => vessel(id, id, { scope: 'sm_1' }))
  const heart = supermodule('sm_1', 'heart', { submoduleOrder: ['a', 'b', 'c', 'lv'] })
  const exposure = [
    ...exposures('sm_1', [exposed('xp_in', 'a', 'entrance_ports', 'vessel')]),
    { id: 'sm_1~c--sm_1', type: EXPOSURE_EDGE_TYPE, source: 'sm_1~c', target: 'sm_1', data: { exposed: [] } },
  ]
  const inner = { nodes: [heart, a, b, c, lv, chamber, wall], edges: exposure }
  const h1 = subsystem(inner, 'dndnode_1', 'h1', 'sm_1')
  const h2 = subsystem(inner, 'dndnode_2', 'h2', 'sm_1')
  const x = vessel('x', 'x', { scope: 'sm_3' })
  const single = supermodule('sm_3', 'single')
  const solo = subsystem([single, x], 'dndnode_3', 'solo', 'sm_3')
  const y = vessel('y', 'y', { scope: 'sm_4' })
  const lib = supermodule('sm_4', 'lib', { source: { format: 'circulatory_autogen', moduleRef: 'lib:v1', hash: '00000000' } })
  const lib1 = subsystem([lib, y], 'dndnode_4', 'lib1', 'sm_4')
  return {
    nodes: [h1, h2, solo, lib1, ...inner.nodes, single, x, lib, y],
    edges: [connect(a, b, { id: 'e_int' }), ...exposure],
  }
}

describe('asking before the first structural edit inside a shared super-module', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const level = useCanvasLevel()
  const guard = useSupermoduleEditGuard()
  let history, listeners, scope, tools

  /** The store as saved: each node's and edge's model fields, by id. */
  const snapshot = () =>
    JSON.stringify({
      nodes: flow.nodes.value.map(({ id, type, data }) => ({ id, type, data })).sort((x, y) => x.id.localeCompare(y.id)),
      edges: flow.edges.value.map(({ id, source, target, data }) => ({ id, source, target, data })).sort((x, y) => x.id.localeCompare(y.id)),
    })
  const asked = () => vi.waitFor(() => expect(guard.question.value).not.toBeNull())
  const settled = async () => {
    await new Promise((resolve) => setTimeout(resolve, 40))
    await nextTick()
  }
  const select = (ids) => flow.nodes.value.forEach((node) => (node.selected = ids.includes(node.id)))

  beforeEach(async () => {
    setActivePinia(createPinia())
    history = useFlowHistoryStore()
    flow.applyDefault.value = false
    scope = effectScope()
    tools = scope.run(() => {
      const { onNodeChange, onEdgeChange } = useFlowHistory({
        suppressedEdgeIds: new Set(),
        indexAddEdge: vi.fn(),
        indexRemoveEdge: vi.fn(),
        updateHelperLines: vi.fn(),
        revertHandlesForEdge: vi.fn(),
        reactivateEdgeHandles: vi.fn(),
      })
      listeners = [flow.onNodesChange(onNodeChange), flow.onEdgesChange(onEdgeChange)]
      useConnect({
        suppressedEdgeIds: new Set(),
        confirm: vi.fn(),
        edgeLineOptions: { type: 'smoothstep' },
        confirmActivation: vi.fn(),
        activateHandle: vi.fn(),
        revertHandleIfUnused: vi.fn(),
        revertHandlesForEdge: vi.fn(),
        reactivateEdgeHandles: vi.fn(),
      })
      return {
        dnd: useDragAndDrop(new Set()),
        clipboard: useWorkspaceClipboard({ mousePosition: ref({ x: 50, y: 50 }), allNodeNames: ref([]) }),
        canvasDelete: useCanvasDelete({ confirm: vi.fn(async () => true), history }),
        exposure: useExposure({ history }),
        hierarchy: useHierarchyOperations({ history }),
        data: useNodeDataHistory(),
      }
    })
    level.reset()
    await flow.fromObject({ nodes: [], edges: [] })
    await flow.fromObject(level.withVisibility(graph()))
    history.clear()
  })

  afterEach(() => {
    if (guard.question.value) guard.answer('cancel')
    listeners.forEach((listener) => listener.off())
    scope.stop()
    flow.applyDefault.value = true
  })

  // Each way a structural edit is made inside heart, as h1 shows it.
  const paths = {
    'dropping a module': () => {
      tools.dnd.onDragStart({}, { moduleRef: 'm:m', mathRef: 'file:m', ports: [], variables: [] })
      tools.dnd.onDrop({ clientX: 10, clientY: 10 })
    },
    'dropping an empty super-module': () => {
      tools.dnd.onDragStart({}, { emptySupermodule: true })
      tools.dnd.onDrop({ clientX: 10, clientY: 10 })
    },
    'dropping a super instance': () => {
      tools.dnd.onDragStart({}, { smId: 'sm_3' })
      tools.dnd.onDrop({ clientX: 10, clientY: 10 })
    },
    pasting: async () => {
      select(['sm_1~lv'])
      await tools.clipboard.copySelection()
      select([])
      await tools.clipboard.pasteSelection()
    },
    deleting: () => tools.canvasDelete.deleteNodes(['sm_1~b']),
    connecting: async () => {
      flow.emits.connect({ source: 'sm_1~b', target: 'sm_1~c', sourceHandle: 'b_out', targetHandle: 'c_in' })
      await nextTick()
    },
    'removing an edge': () => flow.removeEdges(['e_int']),
    'changing couplings': () =>
      tools.data.recordEdit({
        type: 'edit-connection',
        nodeIds: ['sm_1~a', 'sm_1~b'],
        keys: ['ports'],
        edgeIds: ['e_int'],
        apply: () => {
          const edge = flow.findEdge('e_int')
          edge.data = { ...edge.data, couplings: [] }
        },
      }),
    'replacing a module': () =>
      tools.data.recordEdit({
        type: 'replace-module',
        nodeIds: ['sm_1~b'],
        keys: ['moduleRef'],
        structural: true,
        apply: () => flow.updateNodeData('sm_1~b', { moduleRef: 'm:other' }),
      }),
    'exposing ports': () => tools.exposure.saveExposure('sm_1~c--sm_1', [{ key: 'exit_ports:vessel#0', label: 'c_out' }]),
    nesting: () => tools.hierarchy.nest(['sm_1~b', 'sm_1~c'], 'pair'),
    'un-nesting': () => tools.hierarchy.unnestSubsystem('sm_1~lv'),
  }

  it.each(Object.entries(paths))('asks on %s, and Cancel leaves no edit and no undo step', async (_, edit) => {
    level.enter('dndnode_1')
    const before = snapshot()
    const made = edit()
    await asked()
    expect(guard.question.value).toEqual({ name: 'heart', count: 2 })
    // Asked once, the edit made already shows until it is answered.
    guard.answer('cancel')
    await made
    await settled()
    expect(snapshot()).toBe(before)
    expect(history.canUndo).toBe(false)
  })

  it('asks in its dialog, naming the library entry and how many super instances use it, and closing it cancels', async () => {
    const wrapper = mount(SupermoduleEditDialog, { global: { plugins: [PrimeVue] }, attachTo: document.body })
    level.enter('dndnode_1')
    flow.removeEdges(['e_int'])
    await asked()
    await nextTick()
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog.textContent).toContain("This changes super-module 'heart' in the library, used by 2 super instances.")
    expect([...dialog.querySelectorAll('.dialog-footer button')].map((button) => button.textContent.trim())).toEqual([
      'Cancel',
      'Make this one a new super-module',
      'Change all 2',
    ])
    dialog.querySelector('.p-dialog-close-button').click()
    await vi.waitFor(() => expect(guard.question.value).toBeNull())
    await settled()
    expect(flow.findEdge('e_int')).toBeDefined()
    wrapper.unmount()
  })

  it('changes every super instance on Change all, as one undo step, and asks no more until the canvas leaves', async () => {
    level.enter('dndnode_1')
    flow.removeEdges(['e_int'])
    await asked()
    guard.answer('all')
    await settled()
    expect(flow.findEdge('e_int')).toBeUndefined()
    expect(flow.findNode('dndnode_2').data.smId).toBe('sm_1')
    expect(history.canUndo).toBe(true)

    // Remembered: the next edit is its own step, without asking.
    const pointer = history.pointerIndex
    await tools.canvasDelete.deleteNodes(['sm_1~c'])
    await settled()
    expect(guard.question.value).toBeNull()
    expect(flow.findNode('sm_1~c')).toBeUndefined()
    expect(history.pointerIndex).toBe(pointer + 1)

    await history.undo()
    await history.undo()
    expect(flow.findEdge('e_int')).toBeDefined()
    expect(flow.findNode('sm_1~c')).toBeDefined()

    // Left and entered again, it asks again.
    level.exitTo(0)
    level.enter('dndnode_1')
    flow.removeEdges(['e_int'])
    await asked()
  })

  it('makes this super instance a new super-module on Make new, the edit only in it, as one undo step', async () => {
    level.enter('dndnode_1')
    const before = snapshot()
    flow.removeEdges(['e_int'])
    await asked()
    guard.answer('new')
    await settled()

    // h1 keeps heart's nodes, renamed and no longer the library's; h2 moves to a copy, as heart was.
    expect(flow.findNode('dndnode_1').data.smId).toBe('sm_1')
    expect(flow.findNode('sm_1').data.supermodule).toMatchObject({ name: 'heart_2', source: null })
    const copyId = flow.findNode('dndnode_2').data.smId
    expect(copyId).not.toBe('sm_1')
    expect(flow.findNode(copyId).data.supermodule.name).toBe('heart')
    expect(flow.findEdge('e_int')).toBeUndefined()
    expect(flow.edges.value.some((edge) => edge.source === `${copyId}~a` && edge.target === `${copyId}~b`)).toBe(true)
    expect(level.scope.value).toBe('sm_1')

    // One step: undo puts back both.
    await history.undo()
    await settled()
    expect(snapshot()).toBe(before)
    expect(history.canUndo).toBe(false)
    await history.redo()
    await settled()
    expect(flow.findNode('dndnode_2').data.smId).toBe(copyId)
    expect(flow.findEdge('e_int')).toBeUndefined()

    // Now h1's own, an edit asks no more, even entered again.
    level.exitTo(0)
    level.enter('dndnode_1')
    await tools.canvasDelete.deleteNodes(['sm_1~c'])
    await settled()
    expect(guard.question.value).toBeNull()
    expect(flow.findNode('sm_1~c')).toBeUndefined()
    expect(flow.findNode(`${copyId}~c`)).toBeDefined()
  })

  it('asks for a library super-module with one super instance, and Make new detaches it', async () => {
    level.enter('dndnode_4')
    await tools.canvasDelete.deleteNodes(['sm_4~y'])
    await asked()
    expect(guard.question.value).toEqual({ name: 'lib', count: 1 })
    guard.answer('new')
    await settled()
    expect(flow.findNode('sm_4').data.supermodule).toMatchObject({ name: 'lib_2', source: null })
    expect(flow.findNode('sm_4~y')).toBeUndefined()
    // Detached and alone, it asks no more, even entered again.
    level.exitTo(0)
    level.enter('dndnode_4')
    flow.addNodes(vessel('dndnode_9', 'z', { scope: 'sm_4' }))
    await settled()
    expect(guard.question.value).toBeNull()
  })

  it('never asks for a value edit, a super-module with one copy, or one edited from the library', async () => {
    level.enter('dndnode_1')
    // An override on the super instance, as a parameter edited inside it.
    await tools.data.recordEdit({
      type: 'edit-parameters',
      nodeIds: ['dndnode_1'],
      keys: ['overrides'],
      apply: () => flow.updateNodeData('dndnode_1', { overrides: { a: { R: { value: '2' } } } }),
    })
    await settled()
    expect(guard.question.value).toBeNull()
    expect(history.canUndo).toBe(true)

    level.exitTo(0)
    level.enter('dndnode_3')
    flow.removeNodes(['sm_3~x'])
    await settled()
    expect(guard.question.value).toBeNull()
    expect(flow.findNode('sm_3~x')).toBeUndefined()

    level.editSupermodule('sm_1')
    flow.removeEdges(['e_int'])
    await settled()
    expect(guard.question.value).toBeNull()
    expect(flow.findEdge('e_int')).toBeUndefined()
  })

  it('marks the super-modules an edit changed, not those it made', async () => {
    level.editSupermodule('sm_1')
    flow.removeEdges(['e_int'])
    tools.dnd.onDragStart({}, { emptySupermodule: true })
    tools.dnd.onDrop({ clientX: 10, clientY: 10 })
    await settled()
    expect(guard.isModified('sm_1')).toBe(true)
    expect(guard.isModified('sm_5')).toBe(false)
    expect(guard.isModified('sm_2')).toBe(false)
    // The empty super-module and its super instance, one undo step.
    await history.undo()
    expect(flow.findNode('sm_5')).toBeUndefined()
  })
})
