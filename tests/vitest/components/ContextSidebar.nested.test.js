// @vitest-environment happy-dom
import { computed, reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nodes = ref([])

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({
    nodes,
    edges: ref([]),
    getSelectedNodes: computed(() => nodes.value),
    userSelectionActive: ref(false),
    findNode: (id) => nodes.value.find((node) => node.id === id),
    findEdge: () => undefined,
    updateNodeData: () => {},
  }),
}))

vi.mock('../../../src/composables/useActiveCanvas', async () => {
  const { computed: makeComputed } = await import('vue')
  return { useActiveCanvas: () => ({ selectedNodes: makeComputed(() => nodes.value) }) }
})

// The selected node is a module inside a subsystem entered from the root, or edited on its own.
const mode = ref('instance')
const context = vi.hoisted(() => ({
  writeRow: vi.fn(() => []),
  resetRow: vi.fn(),
}))
vi.mock('../../../src/composables/useParameterContext', async () => {
  const { ref: makeRef } = await import('vue')
  return {
    useParameterContext: () => ({
      contextOf: (node) => ({ mode: node ? mode.value : 'root', modelId: node ? 'sub/x' : null }),
      rowsOf: () => [
        { name: 'k', value: '9', type: 'constant', units: 's' },
        { name: 'm', value: '5', type: 'constant', units: 's' },
      ],
      provenanceOf: () =>
        mode.value === 'instance'
          ? new Map([
              ['k', { chip: 'overridden', isOverridden: true, inherited: '1', status: { state: 'connected' } }],
              ['m', { chip: 'ignored', isOverridden: false, status: null }],
            ])
          : new Map([['k', { total: 3, summary: 'connected in 2/3' }]]),
      targetFor: (node, chosen) => (mode.value === 'supermodule' ? 'supermodule' : chosen),
      writeRow: context.writeRow,
      resetRow: context.resetRow,
      graph: makeRef({}),
    }),
  }
})

const { default: ContextSidebar } = await import('../../../src/components/ContextSidebar.vue')

let wrapper
afterEach(() => wrapper?.unmount())

async function mountOnParams() {
  wrapper = mount(ContextSidebar, {
    global: { plugins: [PrimeVue], stubs: { DataTable: { render: () => null }, NodeColourPanel: true }, directives: { tooltip: {} } },
  })
  wrapper.vm.isCollapsed = false
  wrapper.vm.activeTabId = 'params'
  await flushPromises()
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
  await flushPromises()
}

const findRow = (name) => wrapper.vm.parameterRows.find((row) => row.name === name)

describe('ContextSidebar inside a subsystem', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mode.value = 'instance'
    nodes.value = [reactive({ id: 'sm_1~x', data: { scope: 'sm_1', localId: 'x', name: 'x', variables: [] } })]
  })

  it('shows the values there, chipped by where they come from', async () => {
    await mountOnParams()
    expect(findRow('k')).toMatchObject({ value: '9', chip: 'overridden', statusText: 'connected; super-module value 1' })
    expect(findRow('m').chip).toBe('ignored')
    expect(wrapper.text()).toContain('Edits apply to')
  })

  it('edits this subsystem by default, only its value, and the super-module’s default when switched', async () => {
    await mountOnParams()
    expect(wrapper.vm.editTarget).toBe('instance')
    expect(wrapper.vm.isOverrideTarget).toBe(true)

    findRow('k').value = '4'
    wrapper.vm.handleParameterValueChange(findRow('k'))
    expect(context.writeRow).toHaveBeenLastCalledWith(nodes.value[0], 'k', { value: '4', type: 'constant' }, expect.objectContaining({ target: 'instance' }))

    wrapper.vm.editTarget = 'supermodule'
    wrapper.vm.handleParameterValueChange(findRow('k'))
    expect(context.writeRow).toHaveBeenLastCalledWith(nodes.value[0], 'k', expect.anything(), expect.objectContaining({ target: 'supermodule' }))
  })

  it('edits a super-module edited on its own only as its default, its statuses summed up', async () => {
    mode.value = 'supermodule'
    await mountOnParams()
    expect(wrapper.vm.editTarget).toBe('supermodule')
    expect(wrapper.vm.editTargetOptions[0]).toMatchObject({ value: 'instance', disabled: true })
    expect(findRow('k').summary).toBe('connected in 2/3')
  })
})
