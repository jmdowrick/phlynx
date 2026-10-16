import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { constant, module, superInstance, supermodule } from '../fixtures/hierarchy/graph.js'

const nodes = ref([])

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({
    nodes,
    edges: ref([]),
    findNode: (id) => nodes.value.find((node) => node.id === id),
    findEdge: () => undefined,
    updateNodeData: (id, patch) => {
      const node = nodes.value.find((candidate) => candidate.id === id)
      if (node) node.data = { ...node.data, ...patch }
    },
  }),
}))

const notified = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() }))
vi.mock('../../../src/utils/notify', () => ({ notify: notified }))

const { useLocalConstants } = await import('../../../src/composables/useLocalConstants.js')
const { useFlowHistoryStore } = await import('../../../src/stores/historyStore.js')
const { useLibraryStore } = await import('../../../src/stores/libraryStore.js')
const { useModelWriter } = await import('../../../src/composables/useModelWriter.js')
const { useNodeDataHistory } = await import('../../../src/composables/useNodeDataHistory.js')

const local = (name, value = '3') => ({ name, type: 'local_constant', value, units: 'dimensionless' })
const findNode = (id) => nodes.value.find((node) => node.id === id)
const rowOf = (id, name) => findNode(id).data.variables.find((row) => row.name === name)

/** segment (sm_1: p, q), p binding k and q holding a constant k; seg1 overrides k. */
function graph() {
  const p = module('p', 'p', { scope: 'sm_1', variables: [local('k'), constant('R', '1')] })
  const q = module('q', 'q', { scope: 'sm_1', variables: [constant('k', '8')] })
  const sm = supermodule('sm_1', 'segment', { submoduleOrder: ['p', 'q'], localConstants: [{ name: 'k', units: 'dimensionless', value: '3' }] })
  const seg1 = superInstance([sm, p, q], 'dndnode_1', 'seg1', 'sm_1', { overrides: { '@': { k: { value: '2' } } } })
  return [seg1, sm, p, q]
}

describe('useLocalConstants', () => {
  let history
  let constants

  beforeEach(() => {
    setActivePinia(createPinia())
    history = useFlowHistoryStore()
    nodes.value = graph()
    constants = useLocalConstants()
    notified.info.mockClear()
  })

  /** seg1 (and a second copy, seg2) override q's k and R, which binding k leaves inert but for R. */
  function withQOverrides() {
    const [seg1, sm, p, q] = nodes.value
    seg1.data.overrides = { ...seg1.data.overrides, q: { k: { value: '5' }, R: { value: '6' } } }
    q.data.variables = [constant('k', '8'), constant('R', '1')]
    const seg2 = superInstance([sm, p, q], 'dndnode_2', 'seg2', 'sm_1', { overrides: { q: { k: { value: '4' } } } })
    nodes.value = [seg1, seg2, sm, p, q]
  }
  const notices = () => notified.info.mock.calls.map(([note]) => note.message)

  it('drops the overrides of the rows a declaration binds, in its step, and says how many it replaced', async () => {
    withQOverrides()
    await constants.declare('sm_1', { name: 'k2', units: 'dimensionless', value: '1' }, { bind: true })
    expect(notices()).toEqual([])
    findNode('sm_1').data.supermodule = { ...findNode('sm_1').data.supermodule, localConstants: [] }
    expect(await constants.declare('sm_1', { name: 'k', units: 'dimensionless', value: '3' }, { bind: true })).toBe(true)
    expect(rowOf('sm_1~q', 'k').type).toBe('local_constant')
    expect(findNode('dndnode_1').data.overrides).toEqual({ '@': { k: { value: '2' } }, q: { R: { value: '6' } } })
    expect(findNode('dndnode_2').data.overrides).toEqual({})
    expect(notices()).toEqual(['The local constant replaced 2 per-instance values, which no longer had an effect.'])

    await history.undo()
    expect(rowOf('sm_1~q', 'k')).toEqual(constant('k', '8'))
    expect(findNode('dndnode_1').data.overrides.q).toEqual({ k: { value: '5' }, R: { value: '6' } })
    expect(findNode('dndnode_2').data.overrides).toEqual({ q: { k: { value: '4' } } })
  })

  it('drops the overrides of a row retyped to a local constant, in the write’s step, and keeps them otherwise', async () => {
    withQOverrides()
    const writer = useModelWriter()
    const { recordEdit } = useNodeDataHistory()
    const write = (patch) =>
      recordEdit({
        type: 'edit-parameters',
        ...writer.recordTargetOf('sm_1~q', { target: 'supermodule', variable: 'k', patch }),
        apply: () => writer.writeValue('sm_1~q', 'k', patch, { target: 'supermodule' }),
      })
    await write({ value: '8', type: 'boundary_condition' })
    expect(findNode('dndnode_2').data.overrides).toEqual({ q: { k: { value: '4' } } })
    expect(notices()).toEqual([])

    await write({ value: '8', type: 'local_constant' })
    expect(rowOf('sm_1~q', 'k').type).toBe('local_constant')
    expect(findNode('dndnode_1').data.overrides.q).toEqual({ R: { value: '6' } })
    expect(findNode('dndnode_2').data.overrides).toEqual({})
    expect(notices()).toEqual(['The local constant replaced 2 per-instance values, which no longer had an effect.'])

    await history.undo()
    expect(rowOf('sm_1~q', 'k').type).toBe('boundary_condition')
    expect(findNode('dndnode_1').data.overrides.q).toEqual({ k: { value: '5' }, R: { value: '6' } })
    expect(findNode('dndnode_2').data.overrides).toEqual({ q: { k: { value: '4' } } })
  })

  it('offers the modules’ undeclared constants and says which modules use a declared one', () => {
    expect(constants.candidatesOf('sm_1')).toEqual([{ name: 'R', units: 'dimensionless', value: '1', count: 1 }])
    expect(constants.usageOf('sm_1', 'k').map((node) => node.id)).toEqual(['sm_1~p'])
  })

  it('declares one, binding the modules’ constants of its name in the same step, and refuses a name taken', async () => {
    useLibraryStore().assignGlobalConstant('g', '1', 'dimensionless', 'test')
    await expect(constants.declare('sm_1', { name: 'g' })).rejects.toThrow('"g" is a global constant.')
    await expect(constants.declare('sm_1', { name: 'k' })).rejects.toThrow('already a local constant')

    expect(await constants.declare('sm_1', { name: 'R', units: 'dimensionless', value: '4' }, { bind: true })).toBe(true)
    expect(findNode('sm_1').data.supermodule.localConstants.map((declaration) => declaration.name)).toEqual(['k', 'R'])
    expect(rowOf('sm_1~p', 'R')).toEqual(local('R', '4'))
    await history.undo()
    expect(findNode('sm_1').data.supermodule.localConstants).toHaveLength(1)
    expect(rowOf('sm_1~p', 'R')).toEqual(constant('R', '1'))
  })

  it('sets a declared value as one step', async () => {
    await constants.update('sm_1', 'k', { value: '6' })
    expect(findNode('sm_1').data.supermodule.localConstants[0].value).toBe('6')
    await history.undo()
    expect(findNode('sm_1').data.supermodule.localConstants[0].value).toBe('3')
  })

  it('removes one, its rows retyped and its overrides moved onto them, as one step undone at once', async () => {
    expect(await constants.remove('sm_1', 'k')).toBe(true)
    expect(findNode('sm_1').data.supermodule.localConstants).toEqual([])
    expect(rowOf('sm_1~p', 'k')).toEqual({ ...local('k'), type: 'constant', value: '3' })
    expect(rowOf('sm_1~q', 'k')).toEqual(constant('k', '8'))
    expect(findNode('dndnode_1').data.overrides).toEqual({ p: { k: { value: '2' } } })

    await history.undo()
    expect(findNode('sm_1').data.supermodule.localConstants).toHaveLength(1)
    expect(rowOf('sm_1~p', 'k')).toEqual(local('k'))
    expect(findNode('dndnode_1').data.overrides).toEqual({ '@': { k: { value: '2' } } })
    await history.redo()
    expect(rowOf('sm_1~p', 'k').type).toBe('constant')
  })
})
