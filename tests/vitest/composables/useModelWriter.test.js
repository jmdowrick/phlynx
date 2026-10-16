// @vitest-environment happy-dom
import { useVueFlow } from '@vue-flow/core'
import { toRaw } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const notify = vi.hoisted(() => ({ warning: vi.fn() }))
vi.mock('../../../src/utils/notify', () => ({ notify }))

const { useModelWriter } = await import('../../../src/composables/useModelWriter.js')
const { FLOW_IDS } = await import('../../../src/utils/constants.js')
const { useModelGraph } = await import('../../../src/composables/useModelGraph.js')
const { applyParametersToModel } = await import('../../../src/utils/parameters.js')
const { connect, constant, exposed, module, port, subsystem, supermodule } = await import('../fixtures/hierarchy/graph.js')

describe('useModelWriter', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const { writeValue, writeVariables } = useModelWriter()
  const rows = () => [{ ...constant('R', '1'), data_reference: 'ref' }, constant('C', '2')]

  beforeEach(() => {
    notify.warning.mockClear()
    flow.nodes.value = []
    flow.addNodes([module('a', 'a', { variables: rows() }), module('ra', 'ra', { scope: 'sm_1', variables: rows() })])
  })

  it('writes a root module’s row to its node, leaving its other rows and fields', () => {
    const before = flow.findNode('a').data
    const written = writeValue('a', 'R', { value: '5' })
    const after = flow.findNode('a').data
    expect(after.variables).toEqual([{ ...constant('R', '5'), data_reference: 'ref' }, constant('C', '2')])
    expect(written).toBe(toRaw(after.variables))
    // Through updateNodeData, which puts in a new data object.
    expect(after).not.toBe(before)
    expect(after.name).toBe('a')
  })

  it('writes all of a root module’s rows', () => {
    const variables = [constant('R', '3')]
    expect(writeVariables('a', variables, { target: 'supermodule' })).toBe(variables)
    expect(toRaw(flow.findNode('a').data.variables)).toBe(variables)
  })

  it('doesn’t write a module inside a subsystem yet, and says so', () => {
    expect(writeValue('dndnode_1/ra', 'R', { value: '5' })).toBeNull()
    expect(writeValue('sm_1~ra', 'R', { value: '5' })).toBeNull()
    expect(writeVariables('sm_1~ra', [])).toBeNull()
    expect(flow.findNode('sm_1~ra').data.variables).toEqual(rows())
    expect(notify.warning).toHaveBeenCalledTimes(3)
    expect(notify.warning.mock.calls[0][0].title).toBe('Not yet supported')
  })

  it('writes a parameters file’s root rows as the workspace loads it, and no warning for those inside subsystems', () => {
    // Root a → heart (sm_1: ra → lv) → b.
    const vessel = (localId, name, options = {}) =>
      module(localId, name, {
        ports: [port('entrance_ports', 'vessel', ['v_in']), port('exit_ports', 'vessel', ['v'])],
        variables: rows(),
        ...options,
      })
    const [ra, lv] = [vessel('ra', 'ra', { scope: 'sm_1' }), vessel('lv', 'lv', { scope: 'sm_1' })]
    const sm = supermodule('sm_1', 'heart', {
      submoduleOrder: ['ra', 'lv'],
      exposedPorts: [exposed('xp_in', 'ra', 'entrance_ports', 'vessel'), exposed('xp_out', 'lv', 'exit_ports', 'vessel')],
    })
    const heart = subsystem([sm, ra, lv], 'dndnode_1', 'heart', 'sm_1')
    const [a, b] = [vessel('dndnode_0', 'a'), vessel('dndnode_2', 'b')]
    const used = new Set()
    flow.nodes.value = []
    flow.addNodes([a, heart, b, sm, ra, lv])
    flow.addEdges([connect(a, heart, { used, id: 'e0' }), connect(heart, b, { used, id: 'e1' }), connect(ra, lv, { id: 'e2' })])

    const row = (variable_name, value) => ({ variable_name, units: 'dimensionless', value, data_reference: 'file' })
    const { graph } = useModelGraph()
    const { variablesById, nested } = applyParametersToModel(graph.value, [row('R_a', '5'), row('R_heart__lv', '7')])
    // As WorkspaceArea's loadParametersData writes them.
    for (const [id, variables] of variablesById) writeVariables(id, variables)

    expect([...variablesById.keys()]).toEqual(['dndnode_0'])
    expect(flow.findNode('dndnode_0').data.variables[0]).toMatchObject({ name: 'R', value: '5', data_reference: 'file' })
    expect(flow.findNode('sm_1~lv').data.variables).toEqual(rows())
    expect(nested.updated).toBe(1)
    expect(notify.warning).not.toHaveBeenCalled()
    flow.edges.value = []
  })

  it('writes nothing to a node that isn’t there, or for an unknown target', () => {
    expect(writeValue('gone', 'R', { value: '5' })).toBeNull()
    expect(notify.warning).not.toHaveBeenCalled()
    expect(() => writeValue('a', 'R', { value: '5' }, { target: 'elsewhere' })).toThrow('Unknown write target')
  })
})
