// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'

import EdgeConnectionDialog from '../../../src/components/EdgeConnectionDialog.vue'
import { expandHierarchy } from '../../../src/services/hierarchy/expand.js'
import { connect, exposed, exposures, module, port, superInstance, supermodule } from '../fixtures/hierarchy/graph.js'

const IN = port('entrance_ports', 'vessel', ['v_in'])
const OUT = port('exit_ports', 'vessel', ['v'])
const vessel = (localId, name, options = {}) => module(localId, name, { ports: [{ ...IN }, { ...OUT }], ...options })

/** Root src1 → pair ← src2, pair a super instance of sm_1 exposing a's and b's entrances: two ports named vessel. */
function twinGraph() {
  const a = vessel('a', 'a', { scope: 'sm_1' })
  const b = vessel('b', 'b', { scope: 'sm_1' })
  const sm = supermodule('sm_1', 'twins', { submoduleOrder: ['a', 'b'] })
  const exposure = exposures('sm_1', [exposed('xp_a', 'a', 'entrance_ports', 'vessel'), exposed('xp_b', 'b', 'entrance_ports', 'vessel')])
  const pair = superInstance({ nodes: [sm, a, b], edges: exposure }, 'dndnode_1', 'pair', 'sm_1')
  const src1 = vessel('dndnode_0', 'src1')
  const src2 = vessel('dndnode_2', 'src2')
  const used = new Set()
  const edges = [connect(src1, pair, { used, id: 'e1' }), connect(src2, pair, { used, id: 'e2' }), ...exposure]
  return { nodes: [src1, pair, src2, sm, a, b], edges }
}

const DialogStub = { template: '<div><slot /><slot name="footer" /></div>' }

describe('EdgeConnectionDialog payload', () => {
  beforeEach(() => setActivePinia(createPinia()))

  /** Opens the dialog on an edge and presses Done, giving what it confirms. */
  async function confirmOn(graph, edgeId) {
    const edge = graph.edges.find((e) => e.id === edgeId)
    const node = (id) => graph.nodes.find((n) => n.id === id)
    const subgraph = new Map(graph.edges.filter((e) => e.id === edgeId || e.target === edge.target).map((e) => [e.id, e]))
    const wrapper = mount(EdgeConnectionDialog, {
      props: { modelValue: false, sourceNode: node(edge.source), targetNode: node(edge.target), activeEdge: edge, subgraph },
      global: {
        plugins: [PrimeVue],
        stubs: { Dialog: DialogStub, VueFlow: true, MultiportKey: true },
        directives: { tooltip: {} },
      },
    })
    await wrapper.setProps({ modelValue: true })
    await nextTick()
    await wrapper.findAll('button').find((button) => button.text() === 'Done').trigger('click')
    return wrapper.emitted('confirm')[0][0]
  }

  it('keeps the exposed port a coupling names, so two of one name stay apart', async () => {
    const graph = twinGraph()
    const payload = await confirmOn(graph, 'e2')
    expect(payload.couplings.map((c) => c.targetPort.exposedPortId)).toEqual(['xp_b'])
    expect(payload.couplings[0].sourcePort).not.toHaveProperty('exposedPortId')
  })

  it('stays distinct after save and reopen, and expandHierarchy resolves each to its own child', async () => {
    const graph = twinGraph()
    for (const id of ['e1', 'e2']) {
      const { couplings } = await confirmOn(graph, id)
      graph.edges.find((e) => e.id === id).data.couplings = couplings
    }
    // Reopened, each edge still names its own port.
    expect((await confirmOn(graph, 'e1')).couplings.map((c) => c.targetPort.exposedPortId)).toEqual(['xp_a'])
    expect((await confirmOn(graph, 'e2')).couplings.map((c) => c.targetPort.exposedPortId)).toEqual(['xp_b'])

    const model = expandHierarchy(graph.nodes, graph.edges)
    expect(model.errors).toEqual([])
    const targetOf = (id) => model.nameOf(model.edges.find((e) => model.origin.get(e.id)?.edgeId === id || e.id === id).target)
    expect([targetOf('e1'), targetOf('e2')]).toEqual([expect.stringMatching(/a$/), expect.stringMatching(/b$/)])
    expect(targetOf('e1')).not.toBe(targetOf('e2'))
  })
})
