import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { normaliseConfig, normalisePorts, restorePorts } from '../../../src/utils/config.js'
import {
  couplingConflicts,
  cycleMultiportType,
  isMultiport,
  multiplyFactor,
  multiportSummary,
  normaliseMultiport,
  parseMultiport,
  restorePortVariables,
  setMultiport,
  setPortVariables,
  setVariableFactor,
  variableTypes,
} from '../../../src/utils/multiport.js'

const port = (variables, multiportType, multiplyFactor) => ({ label: 'p', variables, multiportType, multiplyFactor })

describe('parseMultiport', () => {
  it.each([
    ['sum', 'Sum'],
    ['SUM', 'Sum'],
    [true, 'True'],
    ['true', 'True'],
    ['multiply', 'Multiply'],
    ['None', 'None'],
    ['False', 'None'],
    [undefined, 'None'],
  ])('reads %j as %j', (value, expected) => {
    expect(parseMultiport(value)).toBe(expected)
  })

  it('copies a per-variable list as written', () => {
    const list = ['sum', 'True']
    expect(parseMultiport(list)).toEqual(list)
    expect(parseMultiport(list)).not.toBe(list)
  })

  it('keeps a list whose entries all agree, which CA reads unlike a whole-port value', () => {
    expect(parseMultiport(['sum', 'sum'])).toEqual(['sum', 'sum'])
    expect(parseMultiport(['True', 'True'])).toEqual(['True', 'True'])
    expect(parseMultiport(['sum'])).toEqual(['sum'])
  })

  it('reads an unknown whole-port value as one connection', () => {
    expect(parseMultiport('yes')).toBe('None')
  })
})

describe('normaliseMultiport', () => {
  const configPort = (variables, multi_port, port_type = 'vessel_port') => ({ port_type, variables, multi_port })
  const normalise = (...args) => normaliseMultiport(configPort(...args), 'Module "m:s"')

  it.each([
    [undefined, 'None'],
    [null, 'None'],
    [false, 'None'],
    ['FALSE', 'None'],
    [true, 'True'],
    ['true', 'True'],
    ['SUM', 'Sum'],
    ['multiply', 'Multiply'],
  ])('reads whole-port %j on one variable as %j', (value, expected) => {
    expect(normalise(['v'], value)).toBe(expected)
  })

  it('reads list entries as "sum" or "True", one per variable', () => {
    expect(normalise(['v', 'u'], ['SUM', true])).toEqual(['sum', 'True'])
    expect(normalise(['v', 'w'], ['sum', 'sum'])).toEqual(['sum', 'sum'])
  })

  it('rejects an unknown whole-port value', () => {
    expect(() => normalise(['v'], 'yes')).toThrow(
      `Module "m:s": port "vessel_port" has multi_port 'yes'. It must be "True", "Sum" or "Multiply" (any case), true/false, or a list with one entry per port variable.`
    )
    expect(() => normalise(['v'], 'None')).toThrow(/has multi_port 'None'\./)
  })

  it.each([
    ['Sum', 'Sum'],
    ['multiply', 'Multiply'],
  ])('rejects a whole-port %s on several variables', (value, kind) => {
    expect(() => normalise(['v_in', 'w_in'], value)).toThrow(
      `Module "m:s": port "vessel_port" has multi_port "${value}" but variables ['v_in', 'w_in']. A "${kind}" port must map exactly one variable.`
    )
  })

  it("keeps a volume_port's whole-port Sum, on any number of variables", () => {
    expect(normalise(['q', 'r'], 'sum', 'volume_port')).toBe('Sum')
  })

  it('rejects a list of the wrong length', () => {
    expect(() => normalise(['v', 'u'], ['sum'])).toThrow(
      `Module "m:s": port "vessel_port" has a list-form multi_port ['sum'] of length 1, but 2 variables ['v', 'u']. The list must have one entry per port variable.`
    )
  })

  it.each([
    ['multiply', "'multiply'"],
    [null, 'None'],
    [false, 'False'],
    ['None', "'None'"],
    ['true', "'true'"],
  ])('rejects the list entry %j, shown as CA shows it', (entry, shown) => {
    expect(() => normalise(['q', 'p'], [entry, 'True'])).toThrow(
      `Module "m:s": port "vessel_port" has multi_port entry ${shown} for variable "q". List-form entries must be "sum" or "True".`
    )
  })
})

describe('variableTypes', () => {
  it('applies a whole-port value to every variable', () => {
    expect(variableTypes(port(['a', 'b'], 'Sum'))).toEqual(['Sum', 'Sum'])
    expect(variableTypes(port(['a'], undefined))).toEqual(['None'])
  })

  it('reads a list one entry per variable, ignoring case', () => {
    expect(variableTypes(port(['a', 'b', 'c'], ['sum', 'TRUE', 'Multiply']))).toEqual(['Sum', 'True', 'Multiply'])
  })

  it('reads None beside the other types as True', () => {
    expect(variableTypes(port(['a', 'b', 'c'], ['sum', 'None', false]))).toEqual(['Sum', 'True', 'True'])
  })

  it('rejects a list of the wrong length or with an unknown entry', () => {
    expect(() => variableTypes(port(['a', 'b'], ['sum']))).toThrow(/1 multiport entries for 2 variables/)
    expect(() => variableTypes(port(['a'], ['add']))).toThrow(/unknown multiport "add" for "a"/)
  })
})

describe('multiplyFactor', () => {
  it('reads a whole-port or per-variable factor, 1 when unset', () => {
    expect(multiplyFactor(port(['a', 'b'], 'Multiply', 2), 1)).toBe(2)
    expect(multiplyFactor(port(['a', 'b'], ['multiply', 'multiply'], [2, 3]), 1)).toBe(3)
    expect(multiplyFactor(port(['a'], 'Multiply'), 0)).toBe(1)
  })

  it('rejects a factor that is not a number', () => {
    expect(() => multiplyFactor(port(['a'], 'Multiply', 'x'), 0)).toThrow(/"a" needs a numeric multiply factor/)
  })
})

describe('couplingConflicts', () => {
  it('accepts a sum fed by plain or multiplied variables', () => {
    expect(couplingConflicts(port(['v_sum', 'u'], ['sum', 'True']), port(['v', 'u'], 'None'))).toEqual([])
    expect(couplingConflicts(port(['q'], 'Multiply'), port(['total'], 'Sum'))).toEqual([])
    expect(couplingConflicts(port(['a', 'b'], 'True'), port(['a'], 'None'))).toEqual([])
  })

  it('names the pairs that are both Sum or both Multiply', () => {
    expect(couplingConflicts(port(['x', 'y'], ['sum', 'multiply']), port(['p', 'q'], ['sum', 'multiply']))).toEqual([
      '"x" and "p" are both Sum variables.',
      '"y" and "q" are both Multiply variables.',
    ])
  })

  it('needs as many variables on both sides to sum or multiply', () => {
    expect(couplingConflicts(port(['x', 'y'], ['sum', 'True']), port(['p'], 'None'))).toEqual([
      'Ports "p" and "p" need the same number of variables to sum or multiply.',
    ])
  })

  it("leaves a Multiply on several variables, which CA can't read, to the CA export", () => {
    expect(couplingConflicts(port(['x', 'y'], ['multiply', 'True']), port(['p', 'q'], ['True', 'sum']))).toEqual([])
    expect(couplingConflicts(port(['x', 'y'], 'Multiply'), port(['p', 'q'], 'True'))).toEqual([])
  })

  it('reports a malformed list', () => {
    expect(couplingConflicts(port(['x'], ['sum', 'True']), port(['p'], 'None'))).toEqual([
      'Port "p" has 2 multiport entries for 1 variables.',
    ])
  })
})

describe('setMultiport', () => {
  it('makes every variable True for several connections, or None for one', () => {
    const p = port(['a', 'b'], ['sum', 'multiply'], 2)
    setMultiport(p, false)
    expect(p.multiportType).toBe('None')
    expect(isMultiport(p)).toBe(false)
    setMultiport(p, true)
    expect(p.multiportType).toBe('True')
    expect(isMultiport(p)).toBe(true)
  })
})

describe('cycleMultiportType', () => {
  it('moves one variable through True, Sum and Multiply, never None', () => {
    const p = port(['a'], 'True')
    const seen = []
    for (let i = 0; i < 3; i++) {
      cycleMultiportType(p, 'a')
      seen.push(p.multiportType)
    }
    expect(seen).toEqual(['Sum', 'Multiply', 'True'])
  })

  it('changes only the clicked variable, storing several Sum variables as a list', () => {
    const p = port(['a', 'b'], 'True')
    cycleMultiportType(p, 'a')
    expect(p.multiportType).toEqual(['sum', 'True'])
    cycleMultiportType(p, 'b')
    expect(p.multiportType).toEqual(['sum', 'sum'])
    cycleMultiportType(p, 'a')
    cycleMultiportType(p, 'b')
    expect(p.multiportType).toBe('True')
  })

  it('moves a variable of several through True and Sum only, as CA multiplies only one-variable ports', () => {
    const p = port(['a', 'b'], 'True')
    cycleMultiportType(p, 'a')
    cycleMultiportType(p, 'a')
    expect(p.multiportType).toBe('True')
  })

  it("sums a volume_port's variable as a list, CA's sum over every connection", () => {
    const p = { label: 'volume_port', variables: ['q'], multiportType: 'True' }
    cycleMultiportType(p, 'q')
    expect(p.multiportType).toEqual(['sum'])
  })

  it('moves an older Multiply variable of several back to True', () => {
    const p = port(['a', 'b'], ['multiply', 'sum'], 2)
    cycleMultiportType(p, 'a')
    expect(p.multiportType).toEqual(['True', 'sum'])
  })

  it('gives a new Multiply variable a factor of 1', () => {
    const p = port(['a'], 'Sum', 2)
    cycleMultiportType(p, 'a')
    expect(p).toMatchObject({ multiportType: 'Multiply', multiplyFactor: 1 })
  })
})

describe('setVariableFactor', () => {
  it('stores one factor until the Multiply variables differ', () => {
    const p = port(['a', 'b', 'c'], ['multiply', 'multiply', 'True'], 2)
    setVariableFactor(p, 'b', 2)
    expect(p.multiplyFactor).toBe(2)
    setVariableFactor(p, 'b', 3)
    expect(p.multiplyFactor).toEqual([2, 3, null])
  })
})

describe('restorePortVariables', () => {
  it('puts back removed variables, keeping later changes to the others', () => {
    const p = port(['a', 'b'], ['sum', 'True'])
    const earlier = { ...p }
    setPortVariables(p, ['b'])
    cycleMultiportType(p, 'b')
    restorePortVariables(p, earlier)
    expect(p).toMatchObject({ variables: ['a', 'b'], multiportType: ['sum', 'sum'] })
  })

  it('makes a Multiply set since on the one-variable port True among several variables', () => {
    const p = port(['a', 'b'], 'True')
    const earlier = { ...p }
    setPortVariables(p, ['a'])
    cycleMultiportType(p, 'a')
    cycleMultiportType(p, 'a')
    expect(p.multiportType).toBe('Multiply')
    restorePortVariables(p, earlier)
    expect(p).toMatchObject({ variables: ['a', 'b'], multiportType: 'True' })
  })

  it('puts back an earlier Multiply on several variables as it was', () => {
    const p = port(['a', 'b'], ['multiply', 'multiply'], [2, 3])
    const earlier = { ...p }
    setPortVariables(p, ['a'])
    restorePortVariables(p, earlier)
    expect(p).toMatchObject({ variables: ['a', 'b'], multiportType: ['multiply', 'multiply'], multiplyFactor: [2, 3] })
  })

  it('follows a rename back', () => {
    const p = port(['x'], 'True')
    const earlier = { ...p }
    setPortVariables(p, ['y'], () => 'x')
    cycleMultiportType(p, 'y')
    restorePortVariables(p, earlier, () => 'y')
    expect(p).toMatchObject({ variables: ['x'], multiportType: 'Sum' })
  })
})

describe('setPortVariables', () => {
  it('keeps each variable with its type and factor through a reorder or removal', () => {
    const p = port(['a', 'b', 'c'], ['multiply', 'sum', 'True'], [2, null, null])
    setPortVariables(p, ['c', 'a', 'b'])
    expect(p).toMatchObject({ variables: ['c', 'a', 'b'], multiportType: ['True', 'multiply', 'sum'], multiplyFactor: 2 })
    setPortVariables(p, ['b'])
    expect(p).toMatchObject({ variables: ['b'], multiportType: 'Sum' })
  })

  it('adds a variable as True on a multiport and None otherwise', () => {
    const multi = port(['a'], 'Sum')
    setPortVariables(multi, ['a', 'b'])
    expect(multi.multiportType).toEqual(['sum', 'True'])
    const single = port(['a'], 'None')
    setPortVariables(single, ['a', 'b'])
    expect(single.multiportType).toBe('None')
  })

  it('links a one-variable Multiply port as True once it has several variables', () => {
    const p = port(['q'], 'Multiply', 2)
    setPortVariables(p, ['q', 'p'])
    expect(p.multiportType).toBe('True')
  })

  it('keeps a Multiply on several variables through a rename or removal', () => {
    const p = port(['a', 'b', 'c'], ['multiply', 'True', 'True'])
    setPortVariables(p, ['x', 'b'], (name) => (name === 'x' ? 'a' : name))
    expect(p.multiportType).toEqual(['multiply', 'True'])
  })

  it.each([
    ['a list sum', ['q'], ['sum'], ['sum']],
    ['a list sum on several variables', ['q', 'r'], ['sum', 'sum'], ['sum', 'sum']],
    ['the legacy whole-port Sum', ['q', 'r'], 'Sum', 'Sum'],
  ])("keeps a volume_port's %s through a rename", (_, variables, multiportType, expected) => {
    const p = { label: 'volume_port', variables, multiportType }
    setPortVariables(p, ['x', ...variables.slice(1)], (name) => (name === 'x' ? 'q' : name))
    expect(p.multiportType).toEqual(expected)
  })

  it('keeps a volume_port list sum when a variable is removed', () => {
    const p = { label: 'volume_port', variables: ['q', 'r'], multiportType: ['sum', 'sum'] }
    setPortVariables(p, ['q'])
    expect(p.multiportType).toEqual(['sum'])
  })

  it('keeps a port with no variables yet a multiport', () => {
    const p = port([], 'True')
    setPortVariables(p, ['a', 'b'])
    expect(p.multiportType).toBe('True')
  })

  it('follows a rename', () => {
    const p = port(['a', 'b'], ['sum', 'True'])
    setPortVariables(p, ['x', 'b'], (name) => (name === 'x' ? 'a' : name))
    expect(p.multiportType).toEqual(['sum', 'True'])
  })

  it('keeps the whole-port value when every variable is removed', () => {
    const p = port(['a'], 'Sum')
    setPortVariables(p, [])
    expect(p).toMatchObject({ variables: [], multiportType: 'Sum' })
  })
})

describe('restorePorts', () => {
  const exported = (label, variables, multiportType) =>
    restorePorts([{ portType: 'exit_ports', label, variables, multiportType }]).exit_ports[0].multi_port

  it.each([
    ['Sum', ['sum', 'sum']],
    ['Multiply', ['multiply', 'multiply']],
  ])('writes a whole-port %s on several variables per variable', (type, expected) => {
    expect(exported('vessel_port', ['v', 'w'], type)).toEqual(expected)
  })

  it("keeps a whole-port value on one variable, and a volume_port's whole-port Sum", () => {
    expect(exported('vessel_port', ['v'], 'Sum')).toBe('Sum')
    expect(exported('vessel_port', ['v', 'w'], 'True')).toBe('True')
    expect(exported('volume_port', ['q', 'r'], 'Sum')).toBe('Sum')
  })

  it('writes no multi_port for one connection', () => {
    expect(exported('vessel_port', ['v'], 'None')).toBeUndefined()
  })
})

describe("the issue's examples", () => {
  const config = (port) => ({ module_type: 'm', module_subtype: 's', exit_ports: [port] })
  const roundTrip = (port) => restorePorts(normalisePorts(config(port))).exit_ports[0].multi_port

  it('round-trips a two-variable all-sum list as written', () => {
    expect(roundTrip({ port_type: 'vessel_port', variables: ['v_in', 'w_in'], multi_port: ['sum', 'sum'] })).toEqual(['sum', 'sum'])
  })

  it('round-trips a volume_port list sum as the generic sum, not the whole-port legacy one', () => {
    expect(roundTrip({ port_type: 'volume_port', variables: ['q'], multi_port: ['sum'] })).toEqual(['sum'])
  })

  it('offers no Multiply on a variable of several, so no list multiply is made', () => {
    const p = port(['q', 'p'], 'True')
    for (let i = 0; i < 3; i++) {
      cycleMultiportType(p, 'q')
      expect(p.multiportType).not.toContain('multiply')
    }
  })

  it("rejects multi_port 'yes' on import, and reads it as one connection when lenient", () => {
    const yes = { port_type: 'vessel_port', variables: ['v'], multi_port: 'yes' }
    expect(() => normalisePorts(config(yes), { strict: true })).toThrow(`Module "m:s": port "vessel_port" has multi_port 'yes'.`)
    expect(normalisePorts(config(yes))[0].multiportType).toBe('None')
  })
})

it('round-trips a per-variable multi_port through a bundled config', () => {
  const configs = JSON.parse(readFileSync('src/assets/module_configs/BG.json', 'utf8'))
  const config = structuredClone(configs.find((c) => c.module_type === 'Nout_junction' && c.module_subtype === 'pv_simple'))
  config.exit_ports[0].multi_port = ['sum', 'True']

  const module = normaliseConfig(config)
  const exitPort = module.ports.find((p) => p.portType === 'exit_ports')
  expect(variableTypes(exitPort)).toEqual(['Sum', 'True'])
  expect(restorePorts(module.ports).exit_ports[0].multi_port).toEqual(['sum', 'True'])
})

describe('multiportSummary', () => {
  const own = (variables, multiportType, multiplyFactor, label = 'own') => ({
    label,
    portType: 'general_ports',
    variables,
    multiportType,
    multiplyFactor,
  })
  const other = (variables, multiportType, multiplyFactor, label = 'other') => ({
    label,
    portType: 'general_ports',
    variables,
    multiportType,
    multiplyFactor,
  })
  const edge = (id, source, target, sourcePort, targetPort) => ({ id, source, target, data: { couplings: [{ sourcePort, targetPort }] } })
  const names = { hub: 'Hub', a: 'Leaf A', b: 'Leaf B' }
  const nameOf = (id) => names[id] ?? id
  /** The summary for node hub, its ports unedited. */
  const summarise = (ports, edges) =>
    multiportSummary('hub', edges, { nameOf, ownPorts: ports.map((port) => ({ original: port, current: port })) })
  const brief = (entry) => entry.terms.map(({ nodeId, variable, factor, role }) => ({ nodeId, variable, factor, role }))

  it('sums the paired variable of every connection, on either end of the edge', () => {
    const hub = own(['v_sum'], 'Sum')
    const [entry] = summarise(
      [hub],
      [edge('e1', 'hub', 'a', hub, other(['v'], 'None')), edge('e2', 'b', 'hub', other(['w'], 'True'), hub)]
    )
    expect(entry).toMatchObject({ variable: 'v_sum', portLabel: 'own', type: 'Sum', issues: [], pending: false })
    expect(entry.terms).toEqual([
      { nodeId: 'a', nodeName: 'Leaf A', edgeId: 'e1', portLabel: 'other', variable: 'v', factor: 1, role: 'term' },
      { nodeId: 'b', nodeName: 'Leaf B', edgeId: 'e2', portLabel: 'other', variable: 'w', factor: 1, role: 'term' },
    ])
  })

  it("scales a summed term by a Multiply neighbour's factor", () => {
    const hub = own(['v_sum'], 'Sum')
    const [entry] = summarise([hub], [edge('e1', 'hub', 'a', hub, other(['v'], 'Multiply', 2))])
    expect(brief(entry)).toEqual([{ nodeId: 'a', variable: 'v', factor: 2, role: 'term' }])
  })

  it('sends a Multiply variable times its factor to a plain or Sum neighbour', () => {
    const hub = own(['q'], 'Multiply', 3)
    const [entry] = summarise(
      [hub],
      [edge('e1', 'hub', 'a', hub, other(['q_in'], 'None')), edge('e2', 'hub', 'b', hub, other(['q_sum'], 'Sum'))]
    )
    expect(entry).toMatchObject({ type: 'Multiply', factor: 3 })
    expect(brief(entry)).toEqual([
      { nodeId: 'a', variable: 'q_in', factor: 3, role: 'scaled' },
      { nodeId: 'b', variable: 'q_sum', factor: 3, role: 'feedsSum' },
    ])
  })

  it('lists only Sum and Multiply variables of a per-variable port, pairing by position', () => {
    const hub = own(['v_sum', 'u', 'q'], ['sum', 'True', 'multiply'], [null, null, 4])
    const entries = summarise([hub], [edge('e1', 'hub', 'a', hub, other(['v', 'u', 'q_in'], 'True'))])
    expect(entries.map(({ variable, type }) => [variable, type])).toEqual([
      ['v_sum', 'Sum'],
      ['q', 'Multiply'],
    ])
    expect(brief(entries[0])).toEqual([{ nodeId: 'a', variable: 'v', factor: 1, role: 'term' }])
    expect(brief(entries[1])).toEqual([{ nodeId: 'a', variable: 'q_in', factor: 4, role: 'scaled' }])
  })

  it('lists a Sum variable nothing is connected to with no terms', () => {
    const [entry] = summarise([own(['v_sum'], 'Sum')], [])
    expect(entry).toMatchObject({ variable: 'v_sum', terms: [], issues: [] })
  })

  it('ignores plain variables, plain ports and edges that do not reach the node', () => {
    const hub = own(['v_sum'], 'Sum')
    const entries = summarise(
      [hub, own(['u'], 'True', undefined, 'shared')],
      [edge('e1', 'a', 'b', other(['v'], 'None'), other(['v'], 'None'))]
    )
    expect(entries).toHaveLength(1)
    expect(entries[0].terms).toEqual([])
  })

  it('reads both ends of an edge from the node to itself', () => {
    const hub = own(['v_sum'], 'Sum')
    const loop = own(['v'], 'None', undefined, 'loop')
    const [entry] = summarise([hub, loop], [edge('e1', 'hub', 'hub', hub, loop)])
    expect(brief(entry)).toEqual([{ nodeId: 'hub', variable: 'v', factor: 1, role: 'term' }])
  })

  it.each([
    ['Sum', 'Sum'],
    ['Multiply', 'Multiply'],
  ])('reports a %s variable paired with another %s variable', (type) => {
    const hub = own(['x'], type, 2)
    const [entry] = summarise([hub], [edge('e1', 'hub', 'a', hub, other(['y'], type, 2))])
    expect(entry).toMatchObject({ terms: [], connected: true })
    expect(entry.issues).toEqual([`"x" and "y" are both ${type} variables.`])
  })

  it('reports a conflict once however many neighbours repeat it', () => {
    const hub = own(['x'], 'Sum')
    const [entry] = summarise([hub], ['a', 'b'].map((id) => edge(id, 'hub', id, hub, other(['y'], 'Sum'))))
    expect(entry.issues).toEqual(['"x" and "y" are both Sum variables.'])
  })

  it('notes a Sum variable that another of the node\'s ports connects', () => {
    const hub = own(['x'], 'Sum', undefined, 'unused')
    const shared = own(['x'], 'True', undefined, 'shared')
    const [entry] = summarise([hub, shared], [edge('e1', 'hub', 'a', shared, other(['y'], 'None'))])
    expect(entry).toMatchObject({ terms: [], connected: false, linkedElsewhere: true })
  })

  it('reports ports of different lengths', () => {
    const hub = own(['v_sum', 'u'], ['sum', 'True'])
    const [entry] = summarise([hub], [edge('e1', 'hub', 'a', hub, other(['v'], 'None'))])
    expect(entry.issues).toEqual(['Ports "own" and "other" need the same number of variables to sum or multiply.'])
  })

  it('reports malformed types and factors instead of throwing', () => {
    const hub = own(['q'], 'Multiply', 'lots')
    const [entry] = summarise([hub], [edge('e1', 'hub', 'a', hub, other(['q_in', 'x'], ['sum']))])
    expect(entry.factor).toBeNull()
    expect(entry.issues).toEqual([
      'Port "own" variable "q" needs a numeric multiply factor.',
      'Port "other" has 1 multiport entries for 2 variables.',
    ])
  })

  it('accepts a variable summed through two connected ports, one entry per port', () => {
    const first = own(['v_sum'], 'Sum', undefined, 'in')
    const second = own(['v_sum'], 'Sum', undefined, 'out')
    const entries = summarise(
      [first, second],
      [edge('e1', 'hub', 'a', first, other(['v'], 'None')), edge('e2', 'hub', 'b', second, other(['w'], 'None'))]
    )
    expect(entries.map((entry) => entry.issues)).toEqual([[], []])
    expect(brief(entries[0])).toEqual([{ nodeId: 'a', variable: 'v', factor: 1, role: 'term' }])
    expect(brief(entries[1])).toEqual([{ nodeId: 'b', variable: 'w', factor: 1, role: 'term' }])
  })

  it('does not change its inputs', () => {
    const hub = own(['v_sum'], 'Sum')
    const edges = [edge('e1', 'hub', 'a', hub, other(['v'], 'Multiply', 'bad'))]
    const frozen = structuredClone(edges)
    summarise([hub], edges)
    expect(edges).toEqual(frozen)
  })

  describe('as the ports are edited', () => {
    const saved = own(['v', 'u'], 'True')
    const edges = [edge('e1', 'hub', 'a', saved, other(['w', 'u'], 'None'))]

    it('reads types and factors from the edited port and connections from the saved one', () => {
      const current = { ...saved, variables: ['v_renamed', 'u'], multiportType: ['multiply', 'True'], multiplyFactor: 5 }
      const [entry] = multiportSummary('hub', edges, { nameOf, ownPorts: [{ original: saved, current }] })
      expect(entry).toMatchObject({ variable: 'v_renamed', type: 'Multiply', factor: 5, pending: false })
      expect(brief(entry)).toEqual([{ nodeId: 'a', variable: 'w', factor: 5, role: 'scaled' }])
    })

    it.each([
      ['label', { label: 'renamed' }],
      ['type', { portType: 'exit_ports' }],
    ])('marks a port whose %s changed as pending, since saving recouples it', (_, change) => {
      const current = { ...saved, multiportType: 'Sum', ...change }
      const entries = multiportSummary('hub', edges, { nameOf, ownPorts: [{ original: saved, current }] })
      expect(entries.every((entry) => entry.pending && !entry.terms.length)).toBe(true)
    })

    it('marks a port added, or given other variables, as pending, with no terms', () => {
      const added = own(['x'], 'Sum', undefined, 'new')
      const grown = { ...saved, variables: ['v', 'u', 'z'], multiportType: 'Sum' }
      const entries = multiportSummary('hub', edges, {
        nameOf,
        ownPorts: [
          { original: undefined, current: added },
          { original: saved, current: grown },
        ],
      })
      expect(entries.every((entry) => entry.pending && !entry.terms.length)).toBe(true)
      expect(entries.map((entry) => entry.variable)).toEqual(['x', 'v', 'u', 'z'])
    })
  })
})
