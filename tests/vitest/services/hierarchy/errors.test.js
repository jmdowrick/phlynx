import { describe, expect, it } from 'vitest'

import { errorsConcerning, summariseExpansionErrors } from '../../../../src/services/hierarchy/errors.js'
import { expandHierarchy } from '../../../../src/services/hierarchy/expand.js'
import { checkScope, resolveScope, summariseScopeReport } from '../../../../src/services/simulation/scopedModel.js'
import { connect, constant, exposed, exposures, module, port, superInstance, supermodule } from '../../fixtures/hierarchy/graph.js'

const error = (message, ids = [], kind = 'unresolvedAlias') => ({ kind, severity: 'error', message, ids, origins: [] })
const warning = (message, ids = [], kind = 'orphanedOverride') => ({ kind, severity: 'warning', message, ids, origins: [] })

const library = { availableMath: new Map([['file:m', '<model/>']]), getGlobalConstant: () => null }
const vessel = (localId, name, options = {}) =>
  module(localId, name, {
    ports: [port('entrance_ports', 'vessel', ['v_in']), port('exit_ports', 'vessel', ['v'])],
    variables: [constant('R', '1')],
    ...options,
  })

/** Root a → seg (sm_1: x), seg exposing x's input only; with its output exposure dropped, seg → b doesn't expand. */
function brokenGraph() {
  const x = vessel('x', 'x', { scope: 'sm_1' })
  const sm = supermodule('sm_1', 'segment', { submoduleOrder: ['x'] })
  const [exposure] = exposures('sm_1', [exposed('xp_in', 'x', 'entrance_ports', 'vessel'), exposed('xp_out', 'x', 'exit_ports', 'vessel')])
  const seg = superInstance({ nodes: [sm, x], edges: [exposure] }, 'dndnode_1', 'seg', 'sm_1', { overrides: { x: { gone: { value: '1' } } } })
  const [a, b] = [vessel('dndnode_0', 'a'), vessel('dndnode_2', 'b')]
  const used = new Set()
  const edges = [connect(a, seg, { used, id: 'e0' }), connect(seg, b, { used, id: 'e1' })]
  // xp_out un-exposed.
  const kept = { ...exposure, data: { exposed: exposure.data.exposed.filter((entry) => entry.id !== 'xp_out') } }
  return expandHierarchy([a, seg, b, sm, x], [...edges, kept])
}

describe('errorsConcerning', () => {
  it('keeps the problems naming a module built, and those naming none', () => {
    const errors = [error('inside', ['a/x']), error('outside', ['b']), warning('anywhere'), error('edge', ['e0', 'a/x'])]
    expect(errorsConcerning(errors, ['a/x', 'c']).map((problem) => problem.message)).toEqual(['inside', 'anywhere', 'edge'])
  })
})

describe('summariseExpansionErrors', () => {
  it('words errors and warnings apart, each message once', () => {
    const errors = [error('broken'), warning('orphan'), error('broken', ['a']), warning('orphan')]
    expect(summariseExpansionErrors(errors)).toEqual({ errors: ['broken'], warnings: ['orphan'] })
  })

  it('is empty for no problems', () => {
    expect(summariseExpansionErrors([])).toEqual({ errors: [], warnings: [] })
  })
})

describe('a scope of the model', () => {
  it('carries the expansion’s problems concerning it', () => {
    const expansion = brokenGraph()
    const scope = resolveScope(['dndnode_2'], expansion.nodes, expansion.edges, [], { modelErrors: expansion.errors })
    expect(scope.modelErrors.map((problem) => problem.kind)).toEqual(['unresolvedAlias', 'orphanedOverride'])
    expect(resolveScope(['dndnode_2'], expansion.nodes, expansion.edges).modelErrors).toEqual([])
  })

  it('stops on the expansion’s errors and warns of its warnings', () => {
    const expansion = brokenGraph()
    const report = checkScope(resolveScope(null, expansion.nodes, expansion.edges, [], { modelErrors: expansion.errors }), library)
    expect(report.canBuild).toBe(false)
    expect(report.errors).toEqual(['Edge "e1" couples to port "xp_out" of "seg", which its super-module no longer exposes.'])
    const { errors, warnings } = summariseScopeReport(report)
    expect(errors).toContain('Edge "e1" couples to port "xp_out" of "seg", which its super-module no longer exposes.')
    expect(warnings).toContain('Super instance "seg" sets "x" variable "gone", which no longer exists.')
  })

  it('adds nothing without the expansion’s problems', () => {
    const report = checkScope(resolveScope(null, [vessel('a', 'a')], []), library)
    expect(report.errors).toEqual([])
    expect(report.modelWarnings).toEqual([])
    expect(checkScope({ ...resolveScope(null, [vessel('a', 'a')], []), modelErrors: undefined }, library).modelWarnings).toEqual([])
  })
})
