// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { beforeEach, describe, expect, it } from 'vitest'

import EdgeConnectionDialog from '../../../src/components/EdgeConnectionDialog.vue'
import PortRow from '../../../src/components/PortRow.vue'
import { connect, exposed, exposures, module, port, superInstance, supermodule } from '../fixtures/hierarchy/graph.js'

const IN = port('entrance_ports', 'vessel', ['v_in'])
const OUT = port('exit_ports', 'vessel', ['v'])
const vessel = (localId, name, options = {}) => module(localId, name, { ports: [{ ...IN }, { ...OUT }], ...options })

/** Root src → pair, pair a super instance of sm_1 exposing a's entrance. */
function graph() {
  const a = vessel('a', 'a', { scope: 'sm_1' })
  const sm = supermodule('sm_1', 'single', { submoduleOrder: ['a'] })
  const exposure = exposures('sm_1', [exposed('xp_a', 'a', 'entrance_ports', 'vessel')])
  const pair = superInstance({ nodes: [sm, a], edges: exposure }, 'dndnode_1', 'pair', 'sm_1')
  const src = vessel('dndnode_0', 'src')
  return { nodes: [src, pair, sm, a], edges: [connect(src, pair, { id: 'e1' }), ...exposure] }
}

// Shows as soon as it mounts, as PrimeVue's Dialog does once open.
const DialogStub = { emits: ['show'], mounted() { this.$emit('show') }, template: '<div><slot /><slot name="footer" /></div>' }
const VueFlowStub = { name: 'VueFlow', props: ['nodes', 'edges'], template: '<div />' }
const global = { plugins: [PrimeVue], directives: { tooltip: {} } }

describe('EdgeConnectionDialog at a super instance', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('offers no Add Port row on the super instance’s side', async () => {
    const { nodes, edges } = graph()
    const node = (id) => nodes.find((n) => n.id === id)
    const wrapper = mount(EdgeConnectionDialog, {
      props: { modelValue: true, sourceNode: node('dndnode_0'), targetNode: node('dndnode_1'), activeEdge: edges[0], subgraph: new Map([['e1', edges[0]]]) },
      global: { ...global, stubs: { Dialog: DialogStub, VueFlow: VueFlowStub, MultiportKey: true } },
    })
    await new Promise((resolve) => setTimeout(resolve, 450))
    await flushPromises()
    const ghosts = wrapper.findComponent({ name: 'VueFlow' }).props('nodes').filter((n) => n.type === 'ghostPort')
    expect(ghosts.map((n) => n.data.side)).toEqual(['source'])
  })

  it('locks an exposed port’s row: type, multiport, variables and delete', () => {
    const row = (exposedPortId) =>
      mount(PortRow, { props: { side: 'target', port: { ...IN, variables: ['v_in'], exposedPortId }, variables: [{ name: 'v_in' }] }, global: { ...global, stubs: { Handle: true } } })
    const locked = row('xp_a')
    expect(locked.findComponent({ name: 'InputText' }).exists()).toBe(false)
    expect(locked.find('.port-label--exposed').text()).toBe('vessel')
    expect(locked.findAll('button').every((button) => button.attributes('disabled') !== undefined)).toBe(true)
    expect(locked.findComponent({ name: 'Select' }).props('disabled')).toBe(true)
    expect(locked.findComponent({ name: 'MultiSelect' }).props('disabled')).toBe(true)
    const free = row(undefined)
    expect(free.findComponent({ name: 'Select' }).props('disabled')).toBe(false)
    expect(free.findAll('button').some((button) => button.attributes('disabled') === undefined)).toBe(true)
  })
})
