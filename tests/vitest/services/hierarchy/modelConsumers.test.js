import { describe, expect, it } from 'vitest'

import { expandHierarchy } from '../../../../src/services/hierarchy/expand.js'
import { resolveParamsForIdRows } from '../../../../src/services/simulation/paramsForId.js'
import { findProtocolTarget } from '../../../../src/services/simulation/protocolTargets.js'
import { buildScopeSignature, resolveScope } from '../../../../src/services/simulation/scopedModel.js'
import { applyParametersToModel, applyParametersToNodes, nestedParametersMessage } from '../../../../src/utils/parameters.js'
import { connect, constant, exposed, module, port, subsystem, supermodule } from '../../fixtures/hierarchy/graph.js'

const vessel = (localId, name, options = {}) =>
  module(localId, name, {
    ports: [port('entrance_ports', 'vessel', ['v_in']), port('exit_ports', 'vessel', ['v'])],
    variables: [constant('R', '1')],
    ...options,
  })

/**
 * Root a → heart (sm_1: ra → lv) → b, expanded.
 *
 * @param {Object} [options]
 * @param {string} [options.lvR='1'] - The super-module's lv's R.
 * @returns {ReturnType<typeof expandHierarchy>}
 */
function heartModel({ lvR = '1' } = {}) {
  const ra = vessel('ra', 'ra', { scope: 'sm_1' })
  const lv = vessel('lv', 'lv', { scope: 'sm_1', variables: [constant('R', lvR)] })
  const sm = supermodule('sm_1', 'heart', {
    submoduleOrder: ['ra', 'lv'],
    exposedPorts: [exposed('xp_in', 'ra', 'entrance_ports', 'vessel'), exposed('xp_out', 'lv', 'exit_ports', 'vessel')],
  })
  const heart = subsystem([sm, ra, lv], 'dndnode_1', 'heart', 'sm_1')
  const [a, b] = [vessel('dndnode_0', 'a'), vessel('dndnode_2', 'b')]
  const used = new Set()
  const edges = [connect(a, heart, { used, id: 'e0' }), connect(heart, b, { used, id: 'e1' }), connect(ra, lv, { id: 'e2' })]
  return expandHierarchy([a, heart, b, sm, ra, lv], edges)
}

const row = (variable_name, value) => ({ variable_name, units: 'dimensionless', value, data_reference: 'test' })

describe('a parameters file loaded into the model', () => {
  it('sets root modules, by their ids, and counts the values naming modules inside subsystems', () => {
    const loaded = applyParametersToModel(heartModel(), [row('R_a', '5'), row('R_heart__lv', '7'), row('R_heart__ra', '8')])
    expect([...loaded.variablesById.keys()]).toEqual(['dndnode_0'])
    expect(loaded.variablesById.get('dndnode_0')).toEqual([{ ...constant('R', '5'), data_reference: 'test' }])
    expect(loaded.updated).toBe(1)
    expect(loaded.nested).toEqual({ updated: 2, paths: ['heart/ra', 'heart/lv'] })
  })

  it('matches as before in a model without subsystems', () => {
    const nodes = [vessel('a', 'a'), vessel('b', 'b')]
    const model = expandHierarchy(nodes, [])
    const rows = [row('R_a', '5'), row('R_c', '6')]
    const { nested, ...loaded } = applyParametersToModel(model, rows)
    expect(loaded).toEqual(applyParametersToNodes(nodes, rows))
    expect(nested).toEqual({ updated: 0, paths: [] })
  })

  it('names at most three of the modules it leaves out', () => {
    expect(nestedParametersMessage(1, ['heart/lv'])).toBe(
      "1 value wasn't applied, as loading parameters doesn't set modules inside subsystems yet: heart/lv."
    )
    expect(nestedParametersMessage(5, ['a/b', 'a/c', 'a/d', 'a/e'])).toBe(
      "5 values weren't applied, as loading parameters doesn't set modules inside subsystems yet: a/b, a/c, a/d and 1 more."
    )
  })
})

describe('a run of the model', () => {
  it('is signed by the modules inside subsystems, so editing a super-module makes its results stale', () => {
    const library = { availableMath: new Map(), availableUnits: [], getGlobalConstant: () => null }
    const signatureOf = (model) => buildScopeSignature(resolveScope(['dndnode_1/lv'], model.nodes, model.edges), library)
    expect(signatureOf(heartModel())).toBe(signatureOf(heartModel()))
    expect(signatureOf(heartModel({ lvR: '2' }))).not.toBe(signatureOf(heartModel()))
  })
})

describe('targets in the model', () => {
  it('find a module inside a subsystem by its flat name, for a protocol', () => {
    const { nodes } = heartModel()
    const mapping = new Map([['dndnode_1/lv::R', 'instance_parameters/heart__lv_R']])
    expect(findProtocolTarget('heart__lv/R', { nodes, mapping, variables: new Map() })).toBe('instance_parameters/heart__lv_R')
  })

  it('find a module inside a subsystem by its flat name, for params_for_id', () => {
    const { nodes } = heartModel()
    const rows = [{ vessel_name: 'heart__lv', param_name: 'R', param_type: 'const', min: '0', max: '2', name_for_plotting: '' }]
    const { selections, warnings } = resolveParamsForIdRows(rows, nodes, () => null)
    expect(warnings).toEqual([])
    expect(selections.map(({ key, nodeName, min, max }) => ({ key, nodeName, min, max }))).toEqual([
      { key: 'dndnode_1/lv::R', nodeName: 'heart__lv', min: 0, max: 2 },
    ])
  })
})
