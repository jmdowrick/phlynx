// @vitest-environment happy-dom
import { defineComponent, h, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFlowHistoryFor } from '../../../src/composables/useFlowHistoryFor.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { HANDLE_VARIANT } from '../../../src/utils/constants.js'

const nodes = ref([])
const edges = ref([])

vi.mock('../../../src/composables/useConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: vi.fn() }) }))
vi.mock('../../../src/utils/layout', () => ({ waitUntilStable: () => Promise.resolve() }))
vi.mock('@vue-flow/core', async (importOriginal) => {
  const { computed } = await import('vue')
  const findNode = (id) => nodes.value.find((node) => node.id === id)
  return {
    ...(await importOriginal()),
    useVueFlow: () => ({
      nodes,
      edges,
      getNodes: nodes,
      getSelectedNodes: computed(() => nodes.value.filter((node) => node.selected)),
      findNode,
      updateNodeData: (id, patch) => {
        const node = findNode(id)
        if (node) node.data = { ...node.data, ...patch }
      },
      updateNodeInternals: vi.fn(),
      addEdges: vi.fn(),
      removeEdges: vi.fn(),
      addNodes: vi.fn(),
      removeNodes: vi.fn(),
      updateNode: vi.fn(),
      screenToFlowCoordinate: (position) => position,
      setViewport: vi.fn(),
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
      onConnect: vi.fn(),
      onConnectEnd: vi.fn(),
      onDragLeave: vi.fn(),
      onNodeChange: vi.fn(),
      onEdgeChange: vi.fn(),
      onNodesInitialized: vi.fn(),
    }),
  }
})

const { default: MacroBuilderDialog } = await import('../../../src/components/MacroBuilderDialog.vue')
const { default: LibraryArea } = await import('../../../src/components/LibraryArea.vue')

const Passthrough = defineComponent({
  setup(_, { slots }) {
    return () => h('div', [slots.header?.(), slots.default?.(), slots.footer?.()])
  },
})

// Stands in for the dialog shell, a descendant that injects like InstanceNode under the flow does,
// and records the stack it resolves.
let descendantHistory
const DialogProbe = defineComponent({
  setup(_, { slots }) {
    descendantHistory = useFlowHistoryFor()
    return () => h('div', [slots.header?.(), slots.default?.(), slots.footer?.()])
  },
})

/**
 * Mounts the open builder.
 *
 * @param {Object} [stubs] - Extra stubs, merged over the defaults.
 */
function mountDialog(stubs = {}) {
  return mount(MacroBuilderDialog, {
    props: { modelValue: true },
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: {} },
      stubs: {
        Dialog: DialogProbe,
        ResizableLibraryPanel: Passthrough,
        LibraryArea: true,
        Menubar: true,
        ConfirmDialog: true,
        VueFlow: true,
        ...stubs,
      },
    },
  })
}

describe('MacroBuilderDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    nodes.value = [
      {
        id: 'a',
        selected: true,
        data: { handles: [{ uid: 'h1', side: 'left', variant: HANDLE_VARIANT.GHOST }] },
      },
    ]
    edges.value = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('records its edits on its own stack, never the workspace one', async () => {
    vi.useFakeTimers()
    const wrapper = mountDialog()
    const workspace = useFlowHistoryStore()

    await wrapper.vm.addHandle('left')
    await wrapper.vm.items[0].command()
    await flushPromises()
    vi.runAllTimers()

    expect(nodes.value).toEqual([])
    expect(workspace.canUndo).toBe(false)
    expect(wrapper.vm.history.canUndo).toBe(true)
  })

  it('gives its descendants its own stack', () => {
    const wrapper = mountDialog()

    expect(descendantHistory).toBe(wrapper.vm.history)
    expect(descendantHistory).not.toBe(useFlowHistoryStore())
  })

  it('keeps the library panel on the workspace stack', () => {
    const wrapper = mountDialog({ LibraryArea: false })

    expect(wrapper.findComponent(LibraryArea).vm.$.setupState.history).toBe(useFlowHistoryStore())
  })
})
