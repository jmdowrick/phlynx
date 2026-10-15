// @vitest-environment happy-dom
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nodes = ref([])
const edges = ref([])
vi.mock('../../../src/utils/notify', () => ({ notify: { warning: vi.fn(), error: vi.fn(), info: vi.fn(), success: vi.fn() } }))
vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({
    nodes,
    edges,
    findNode: (id) => nodes.value.find((node) => node.id === id),
    findEdge: (id) => edges.value.find((edge) => edge.id === id),
    updateNodeData: (id, patch) => {
      const node = nodes.value.find((candidate) => candidate.id === id)
      if (node) node.data = { ...node.data, ...patch }
    },
  }),
}))

const { useInstanceSave } = await import('../../../src/composables/useInstanceSave.js')
const { connect, constant, module, port, subsystem, supermodule } = await import('../fixtures/hierarchy/graph.js')

const vessel = (localId, name, options = {}) =>
  module(localId, name, { ports: [port('general_ports', 'p', ['R'])], variables: [constant('R', '1')], ...options })

/** A save of root module a, switching every other module on its math too. */
const saveOf = (siblings) => ({
  id: 'a',
  name: 'a',
  mathRef: 'file:m',
  previousMathRef: 'file:m',
  math: null,
  layout: null,
  isLayoutChanged: false,
  globalConstants: [],
  variables: [constant('R', '1')],
  ports: [port('general_ports', 'p', ['R'])],
  updateAll: true,
  siblings,
})

describe('useInstanceSave counts in the model', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    edges.value = []
  })

  it('counts each node once without subsystems', async () => {
    const [a, b] = [vessel('a', 'a'), vessel('b', 'b')]
    nodes.value = [a, b]
    edges.value = [connect(a, b, { id: 'e0' })]
    expect(await useInstanceSave().saveInstanceEdit(saveOf(['b']))).toBe(2)
  })

  it('counts a module inside a super-module once for each subsystem of it', async () => {
    const x = vessel('x', 'x', { scope: 'sm_1' })
    const sm = supermodule('sm_1', 'pair', { submoduleOrder: ['x'] })
    nodes.value = [vessel('a', 'a'), subsystem([sm, x], 's1', 's1', 'sm_1'), subsystem([sm, x], 's2', 's2', 'sm_1'), sm, x]
    expect(await useInstanceSave().saveInstanceEdit(saveOf(['sm_1~x']))).toBe(3)
  })
})
