// @vitest-environment happy-dom
import { defineComponent, h, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const flowNodes = ref([])
const flowEdges = ref([])
// The canvas level a test enters.
const level = vi.hoisted(() => ({ instancePath: null, isEditingSupermodule: null }))
vi.mock('../../../src/composables/useConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: async () => true }) }))
vi.mock('@vue-flow/core', async (importOriginal) => {
  const { computed } = await import('vue')
  // One flow, so the model is expanded once per workspace, as in the app.
  let flow
  return { ...(await importOriginal()), useVueFlow: () => (flow ??= { nodes: flowNodes, edges: flowEdges, getSelectedNodes: computed(() => []) }) }
})
vi.mock('../../../src/composables/useCanvasLevel', async () => {
  const { ref } = await import('vue')
  level.instancePath = ref([])
  level.isEditingSupermodule = ref(false)
  return { useCanvasLevel: () => level }
})
vi.mock('../../../src/utils/layout', () => ({ waitUntilStable: () => Promise.resolve() }))
vi.mock('../../../src/composables/useSimulation', async () => {
  const { ref } = await import('vue')
  return { useSimulation: () => ({ run: vi.fn(), stop: vi.fn(), keepCurrent: vi.fn(), isStale: ref(false) }) }
})
vi.mock('../../../src/services/simulation/libopencorLoader', () => ({ libopencor: { status: 'ready' } }))

const { default: InstanceEditorDialog } = await import('../../../src/components/InstanceEditorDialog.vue')
const { connect, exposed, exposures, module, port, superInstance, supermodule } = await import('../fixtures/hierarchy/graph.js')

const MATH_REF = 'file:m'
const XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">
  <component name="m">
    <variable name="t" units="second" interface="public_and_private"/>
    <variable name="x" units="metre" initial_value="1"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><cn cellml:units="metre_per_second" xmlns:cellml="http://www.cellml.org/cellml/2.0#">0</cn></apply>
    </math>
  </component>
</model>`

const Stub = defineComponent({
  emits: ['change', 'undo', 'redo', 'variable-click'],
  setup(_, { expose, slots }) {
    expose({ format: 'mathml', setText: vi.fn(), setModel: vi.fn(), flush: () => {}, getErrors: () => [], focus: () => {}, flushPendingRenames: () => {}, ensureResults: vi.fn() })
    return () => h('div', [slots.header?.(), slots.default?.(), slots.footer?.()])
  },
})

// Shows a tooltip's text on its element, so a test can read it.
const tooltip = {
  mounted: (el, { value }) => (el.dataset.tooltip = value ?? ''),
  updated: (el, { value }) => (el.dataset.tooltip = value ?? ''),
}

/**
 * Super-module heart, whose module ra exposes its port u, placed twice at the root: si_1, whose u root module outer
 * couples to, and si_2, coupled to nothing.
 */
function workspace() {
  const ra = module('ra', 'ra', { scope: 'sm_1', ports: [port('general_ports', 'u', ['x'])], data: { mathRef: MATH_REF } })
  const inner = { nodes: [supermodule('sm_1', 'heart', { submoduleOrder: ['ra'] }), ra], edges: exposures('sm_1', [exposed('xp_1', 'ra', 'general_ports', 'u')]) }
  const si1 = superInstance(inner, 'si_1', 'left', 'sm_1')
  const si2 = superInstance(inner, 'si_2', 'right', 'sm_1')
  const outer = module('outer', 'outer', { ports: [port('general_ports', 'u', ['x'])], data: { mathRef: MATH_REF } })
  flowNodes.value = [outer, si1, si2, ...inner.nodes]
  flowEdges.value = [...inner.edges, connect(outer, si1)]
  return ra
}

let wrapper
afterEach(() => {
  wrapper?.unmount()
  flowNodes.value = []
  flowEdges.value = []
})

/**
 * Opens the editor of a node on its Ports tab.
 *
 * @param {Object} node
 * @returns {Promise<import('@vue/test-utils').DOMWrapper>} The port's status dot.
 */
async function openPorts(node) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  wrapper = mount(InstanceEditorDialog, {
    props: { modelValue: false, id: node.id, initialName: node.data.name, mathRef: MATH_REF, initialPorts: node.data.ports, defaultTab: 'ports' },
    global: {
      plugins: [PrimeVue, router],
      stubs: { Dialog: Stub, CellMLTextEditor: Stub, MathWorkbenchEditor: Stub, ParameterTable: Stub, SimulationPanel: Stub },
      directives: { tooltip },
    },
  })
  await wrapper.setProps({ modelValue: true })
  await flushPromises()
  await vi.waitFor(() => expect(wrapper.find('td .port-status').exists()).toBe(true))
  return wrapper.find('td .port-status')
}

describe('InstanceEditorDialog port status inside super-modules', () => {
  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    useLibraryStore().addMath(MATH_REF, XML)
    level.instancePath.value = []
    level.isEditingSupermodule.value = false
  })

  it('shows a port exposed and coupled above as connected, in the super instance entered', async () => {
    const ra = workspace()
    level.instancePath.value = ['si_1']
    const dot = await openPorts(ra)

    expect(dot.classes()).toContain('port-status--connected')
    expect(dot.attributes('data-tooltip')).toBe('Connected to outer')
  })

  it('shows the port free in a super instance where nothing couples to it', async () => {
    const ra = workspace()
    level.instancePath.value = ['si_2']
    const dot = await openPorts(ra)

    expect(dot.classes()).toContain('port-status--free')
    expect(dot.attributes('data-tooltip')).toBe('Not connected')
  })

  it('shows the port exposed via its interface when its super-module is edited on its own', async () => {
    const ra = workspace()
    level.isEditingSupermodule.value = true
    const dot = await openPorts(ra)

    expect(dot.classes()).toContain('port-status--exposed')
    expect(dot.attributes('data-tooltip')).toBe('Exposed via interface')
    expect(wrapper.find('.ports-key').text()).toContain('Exposed via interface')
  })
})
