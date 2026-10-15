// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FLOW_IDS } from '../../../src/utils/constants.js'
import { exposed, module, port, subsystem, supermodule } from '../fixtures/hierarchy/graph.js'

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
const { default: SubsystemNode } = await import('../../../src/components/SubsystemNode.vue')
const { default: InterfaceNode } = await import('../../../src/components/InterfaceNode.vue')

const IN = port('entrance_ports', 'vessel', ['v_in', 'u'])

/** Root: two subsystems of heart (sm_1, holding lv), and a module. */
function graph() {
  const lv = module('dndnode_0', 'lv', { scope: 'sm_1', ports: [{ ...IN }] })
  const sm = supermodule('sm_1', 'heart', {
    ca: { module_type: 'heart', module_subtype: 'Argus2026_v01' },
    exposedPorts: [exposed('xp_in', 'dndnode_0', 'entrance_ports', 'vessel')],
  })
  const inner = [sm, lv]
  const left = subsystem(inner, 'dndnode_1', 'left', 'sm_1')
  const right = subsystem(inner, 'dndnode_2', 'right', 'sm_1')
  return { nodes: [left, right, ...inner], edges: [] }
}

describe('SubsystemNode', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const level = useCanvasLevel()
  let wrapper

  const mountNode = (id = 'dndnode_1') => {
    wrapper = mount(SubsystemNode, {
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

  it('shows its name, its super-module, how many subsystems that has, and its ports', () => {
    mountNode()
    expect(wrapper.find('.name-text').text()).toBe('left')
    expect(wrapper.find('.subsystem-supermodule').text()).toBe('heart:Argus2026_v01')
    expect(wrapper.find('.subsystem-count').text()).toBe('×2')
    expect(wrapper.find('.subsystem-count').attributes('aria-label')).toBe('2 subsystems of heart')
    expect(wrapper.find('.subsystem-count').attributes('role')).toBe('img')
    expect(wrapper.text()).toContain('1 port')
  })

  it('opens from its Open button', async () => {
    mountNode()
    await wrapper.find('.subsystem-open').trigger('click')
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
    expect(wrapper.find('.subsystem-supermodule--missing').exists()).toBe(true)
    expect(wrapper.find('.subsystem-open').attributes('disabled')).toBeDefined()
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
  const render = (data) => mount(InterfaceNode, { props: { id: 'sm_1', data } })

  it('names its super-module and counts its exposed ports', () => {
    const wrapper = render(graph().nodes.find((node) => node.id === 'sm_1').data)
    expect(wrapper.find('.interface-name').text()).toBe('heart')
    expect(wrapper.find('.interface-ports').text()).toBe('1 exposed port')
  })

  it('says when nothing is exposed yet', () => {
    const wrapper = render(supermodule('sm_2', 'lung').data)
    expect(wrapper.find('.interface-name').text()).toBe('lung')
    expect(wrapper.find('.interface-ports').text()).toBe('No exposed ports yet')
  })
})
