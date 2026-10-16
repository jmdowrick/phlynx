import { describe, expect, it, vi } from 'vitest'

import { useEdgeCouplings } from '../../../src/composables/useEdgeCouplings.js'

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
})
