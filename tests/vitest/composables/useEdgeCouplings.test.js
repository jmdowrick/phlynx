import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

const flowNodes = ref([])
const flowEdges = ref([])
vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({ nodes: flowNodes, edges: flowEdges }),
}))

const { useEdgeCouplings } = await import('../../../src/composables/useEdgeCouplings.js')
const { exposed, exposures, module, port, supermodule } = await import('../fixtures/hierarchy/graph.js')

const vesselPort = (portType, variable) => ({ label: 'vessel_port', portType, variables: [variable], multiportType: 'None' })

describe('useEdgeCouplings', () => {
  it('records the slots of a coupling moved onto the edge it took a port from', async () => {
    const splitPorts = [vesselPort('exit_ports', 'x'), vesselPort('exit_ports', 'y')]
    const entrance = vesselPort('entrance_ports', 'v')
    const coupling = (slot) => ({ sourcePort: { ...splitPorts[slot] }, targetPort: { ...entrance }, sourceSlot: slot, targetSlot: 0 })
    const props = {
      sourceNode: { id: 's', data: { ports: splitPorts } },
      targetNode: { id: 'b', data: { ports: [entrance] } },
      activeEdge: { id: 's--b' },
      subgraph: new Map([
        ['s--a', { id: 's--a', source: 's', target: 'a', data: { couplings: [coupling(0)] } }],
        ['s--b', { id: 's--b', source: 's', target: 'b', data: { couplings: [coupling(1)] } }],
      ]),
    }
    const state = useEdgeCouplings(props, vi.fn().mockResolvedValue('swap'))
    state.initLocalState()
    const [held, own] = state.localSrcPorts.value

    await state.swapConnections(held, own._uid, held._uid, 'source', state.localCouplings.value)

    expect(state.localSubgraph.value.get('s--a').data.couplings).toEqual([
      expect.objectContaining({ sourcePort: expect.objectContaining({ variables: ['y'] }), sourceSlot: 1, targetSlot: 0 }),
    ])
  })

  describe('inside a super-module', () => {
    afterEach(() => {
      flowNodes.value = []
      flowEdges.value = []
    })

    /** Children a → b of sm_1, a's single-connection exit port exposed on its interface. */
    function exposedWorkspace() {
      const a = module('a', 'a', { scope: 'sm_1', ports: [port('exit_ports', 'flow', ['q'])] })
      const b = module('b', 'b', { scope: 'sm_1', ports: [port('entrance_ports', 'flow', ['q'])] })
      flowNodes.value = [supermodule('sm_1', 'heart', { submoduleOrder: ['a', 'b'] }), a, b]
      flowEdges.value = exposures('sm_1', [exposed('xp_1', 'a', 'exit_ports', 'flow')])
      const edge = { id: 'a--b', source: a.id, target: b.id, data: { couplings: [] } }
      return { sourceNode: a, targetNode: b, activeEdge: edge, subgraph: new Map([[edge.id, edge]]) }
    }

    it('counts an exposed single-connection port as taken elsewhere, and never connects it', async () => {
      const state = useEdgeCouplings(exposedWorkspace(), vi.fn().mockResolvedValue('overwrite'))
      state.initLocalState()
      const [own] = state.localSrcPorts.value

      expect(state.takenElsewhereUids.value.has(own._uid)).toBe(true)
      expect(state.localCouplings.value).toEqual([])
      expect(await state.evictHandle(own, own._uid, 'source', [])).toBeNull()
    })

    it('leaves a port that is not exposed free', () => {
      const props = exposedWorkspace()
      flowEdges.value = []
      const state = useEdgeCouplings(props, vi.fn())
      state.initLocalState()

      expect(state.takenElsewhereUids.value.size).toBe(0)
      expect(state.localCouplings.value).toHaveLength(1)
    })
  })
})
