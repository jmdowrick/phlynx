// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FLOW_IDS } from '../../../src/utils/constants.js'
import { exposed, exposures, module, port, superInstance, supermodule } from '../fixtures/hierarchy/graph.js'

const notifyError = vi.hoisted(() => vi.fn())
vi.mock('../../../src/utils/notify', () => ({ notify: Object.assign(vi.fn(), { error: notifyError }) }))

// The node is drawn in the workspace's own flow, as inside its VueFlow.
vi.mock('@vue-flow/core', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    Handle: { name: 'Handle', template: '<div class="handle-stub"><slot /></div>' },
    useVueFlow: (id) => actual.useVueFlow(id ?? 'main-flow-editor'),
  }
})
vi.mock('@vue-flow/node-resizer', () => ({ NodeResizer: { name: 'NodeResizer', template: '<div />' } }))

const { useVueFlow } = await import('@vue-flow/core')
const { useCanvasLevel } = await import('../../../src/composables/useCanvasLevel.js')
const { useFlowHistoryStore } = await import('../../../src/stores/historyStore.js')
const { useSimulationResultsStore } = await import('../../../src/stores/simulationResultsStore.js')
const { default: SuperInstanceNode } = await import('../../../src/components/SuperInstanceNode.vue')
const { default: InterfaceNode } = await import('../../../src/components/InterfaceNode.vue')

const IN = port('entrance_ports', 'vessel', ['v_in', 'u'])

/** Root: two super instances of heart (sm_1, holding lv), and a module. */
function graph() {
  const lv = module('dndnode_0', 'lv', { scope: 'sm_1', ports: [{ ...IN }] })
  const sm = supermodule('sm_1', 'heart', { ca: { module_type: 'heart', module_subtype: 'Argus2026_v01' } })
  const exposure = exposures('sm_1', [exposed('xp_in', 'dndnode_0', 'entrance_ports', 'vessel')])
  const inner = { nodes: [sm, lv], edges: exposure }
  const left = superInstance(inner, 'dndnode_1', 'left', 'sm_1')
  const right = superInstance(inner, 'dndnode_2', 'right', 'sm_1')
  return { nodes: [left, right, sm, lv], edges: exposure }
}

describe('SuperInstanceNode', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const level = useCanvasLevel()
  let wrapper

  const mountNode = (id = 'dndnode_1') => {
    wrapper = mount(SuperInstanceNode, {
      props: { id, data: flow.findNode(id).data },
      global: { plugins: [PrimeVue], directives: { tooltip: {} } },
      attachTo: document.body,
    })
  }
  const nameInput = () => wrapper.find('.instance-name input')

  beforeEach(async () => {
    setActivePinia(createPinia())
    notifyError.mockClear()
    level.reset()
    await flow.fromObject(level.withVisibility(graph()))
  })
  afterEach(() => {
    wrapper?.unmount()
    vi.useRealTimers()
  })

  it('shows its name, its super-module, how many super instances that has, and its ports', () => {
    mountNode()
    expect(wrapper.find('.name-text').text()).toBe('left')
    expect(wrapper.find('.super-instance-supermodule').text()).toBe('heart:Argus2026_v01')
    expect(wrapper.find('.super-instance-count').text()).toBe('×2')
    expect(wrapper.find('.super-instance-count').attributes('aria-label')).toBe('2 super instances of heart')
    expect(wrapper.find('.super-instance-count').attributes('role')).toBe('img')
    expect(wrapper.text()).toContain('1 port')
  })

  it('is an instance card, with the same header, name and button, and a second card stacked behind it', () => {
    mountNode()
    const card = wrapper.find('.instance-card')
    expect(card.classes()).toEqual(expect.arrayContaining(['instance-card', 'super-instance-card']))
    // The front card is the node's only card box: no inline border or offset of its own.
    expect(card.attributes('style') ?? '').not.toMatch(/border|shadow|transform/)
    expect(card.findAll(':scope > *').map((child) => child.classes()[0])).toEqual(['card-header-actions', 'instance-name'])
    expect(card.findAll('.instance-details .detail-item')).toHaveLength(2)
    expect(card.find('.super-instance-open').classes()).toContain('instance-button')

    // Nested by a second edge inside the card, so nothing is drawn outside it.
    expect(wrapper.find('.super-instance-stack').exists()).toBe(false)
  })

  it('opens from its Open button', async () => {
    mountNode()
    await wrapper.find('.super-instance-open').trigger('click')
    expect(level.scope.value).toBe('sm_1')
    expect(level.instancePath.value).toEqual(['dndnode_1'])
  })

  it('opens on a double-click, not a rename', async () => {
    vi.useFakeTimers()
    mountNode()
    await wrapper.find('.name-text').trigger('click', { detail: 1 })
    await wrapper.find('.name-text').trigger('dblclick')
    vi.advanceTimersByTime(500)
    await flushPromises()
    expect(nameInput().exists()).toBe(false)
    expect(level.instancePath.value).toEqual(['dndnode_1'])
  })

  it('says when its super-module is missing, and can’t open', () => {
    flow.removeNodes([{ ...flow.findNode('sm_1'), deletable: true }])
    mountNode()
    expect(wrapper.find('.super-instance-supermodule--missing').exists()).toBe(true)
    expect(wrapper.find('.super-instance-open').attributes('disabled')).toBeDefined()
  })

  it('renames as one undo step, by the rules for names inside super-modules', async () => {
    mountNode()
    await wrapper.find('.name-text').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await nameInput().setValue('left__a')
    await nameInput().trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(notifyError).toHaveBeenCalledWith({ message: expect.stringContaining('"__"') })
    expect(flow.findNode('dndnode_1').data.name).toBe('left')

    await nameInput().setValue('right')
    await nameInput().trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(notifyError).toHaveBeenLastCalledWith({ message: 'A node here already has this name.' })

    await nameInput().setValue('atrium')
    await nameInput().trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(flow.findNode('dndnode_1').data.name).toBe('atrium')
    await useFlowHistoryStore().undo()
    expect(flow.findNode('dndnode_1').data.name).toBe('left')
  })

  it('is outlined as simulated when a module inside it was simulated', async () => {
    mountNode()
    expect(wrapper.classes()).not.toContain('instance-node--simulated')
    const results = useSimulationResultsStore()
    results.results = { ok: true }
    results.scopeNodeIds = ['dndnode_1/dndnode_0']
    await flushPromises()
    expect(wrapper.classes()).toContain('instance-node--simulated')
    results.scopeNodeIds = ['dndnode_2/dndnode_0']
    await flushPromises()
    expect(wrapper.classes()).not.toContain('instance-node--simulated')
  })

  it('asks for its context menu', async () => {
    mountNode()
    await wrapper.trigger('contextmenu', { clientX: 5, clientY: 7 })
    expect(wrapper.emitted('open-context-menu')).toEqual([[{ clientX: 5, clientY: 7, id: 'dndnode_1' }]])
  })
})

describe('InterfaceNode', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const render = (node) => mount(InterfaceNode, { props: { id: node.id, data: node.data } })

  beforeEach(async () => {
    setActivePinia(createPinia())
    await flow.fromObject(graph())
  })

  it('names its super-module and lists the ports its exposure edges expose, with generic handles', () => {
    const node = flow.findNode('sm_1')
    const wrapper = mount(InterfaceNode, {
      props: { id: node.id, data: { ...node.data, handles: [{ uid: 'h1', side: 'left', name: '', variant: 'ghost' }] } },
    })
    expect(wrapper.find('.interface-name').text()).toBe('heart')
    expect(wrapper.findAll('.interface-port-list li').map((item) => item.text())).toEqual(['vesselentrance_ports'])
    expect(wrapper.findAll('.handle-stub')).toHaveLength(1)
  })

  it('says when nothing is exposed yet', () => {
    const wrapper = render(supermodule('sm_2', 'lung'))
    expect(wrapper.find('.interface-name').text()).toBe('lung')
    expect(wrapper.find('.interface-ports').text()).toBe('No exposed ports yet')
  })
})
