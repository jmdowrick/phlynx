import { describe, expect, it } from 'vitest'

import { orderForCa } from '../../../../src/services/export/caOrder.js'
import { buildWorkflowGraph } from '../../../../src/services/import/buildWorkflow.js'

const port = (portType, label, variables, multiportType = 'None') => ({ portType, label, variables, multiportType })
const module = (moduleRef, ports) => ({ moduleRef, mathRef: `m:${moduleRef}`, variables: [], ports })

const SPLIT_PORTS = [
  port('exit_ports', 'vessel_port', ['v0']),
  port('exit_ports', 'vessel_port', ['v1']),
  port('exit_ports', 'ctrl', ['c']),
]
const MODULES = new Map([
  ['split:s', module('split:s', SPLIT_PORTS)],
  ['single:s', module('single:s', [port('exit_ports', 'vessel_port', ['v'])])],
  ['shared:s', module('shared:s', [port('exit_ports', 'vessel_port', ['v'], 'True')])],
  ['join:j', module('join:j', [port('entrance_ports', 'vessel_port', ['w0']), port('entrance_ports', 'vessel_port', ['w1'])])],
  ['vessel:v', module('vessel:v', [port('entrance_ports', 'vessel_port', ['v']), port('exit_ports', 'vessel_port', ['u'])])],
  ['sensor:c', module('sensor:c', [port('entrance_ports', 'ctrl', ['c'])])],
  ['general:one', module('general:one', [port('general_ports', 'p', ['g'])])],
  ['general:two', module('general:two', [port('general_ports', 'p', ['g0']), port('general_ports', 'p', ['g1'])])],
  [
    'heart:vp',
    {
      ...module('heart:vp', [
        port('entrance_ports', 'vessel_port', ['v_ivc', 'u_ra']),
        port('entrance_ports', 'vessel_port', ['v_svc', 'u_ra']),
        port('entrance_ports', 'vessel_port', ['v_pvn', 'u_la']),
        port('exit_ports', 'vessel_port', ['v_aov', 'u_root']),
        port('exit_ports', 'vessel_port', ['v_puv', 'u_par']),
      ]),
      variables: [{ name: 'v_ivc', type: 'boundary_condition', value: null }],
    },
  ],
])

/**
 * Makes a module array row.
 *
 * @param {string} name
 * @param {string} type - `module_type:module_subtype`.
 * @param {string} [out] - out_instances.
 * @param {string} [inp] - inp_instances.
 * @returns {Object}
 */
function row(name, type, out = '', inp = '') {
  const [module_type, module_subtype] = type.split(':')
  return { name, module_type, module_subtype, out_instances: out, inp_instances: inp }
}

/**
 * Builds a module array and lists each edge's couplings by `source>target`, as `label:sourceSlot>targetSlot`.
 *
 * @param {Array} rows
 * @param {Object} [options] - buildWorkflowGraph's options.
 * @returns {{ slots: Object, conflicts: Array<string>, unmatched: Array<string>, nodes: Array,
 *   ivcZeroedHearts: string[] }}
 */
function build(rows, options) {
  const graph = buildWorkflowGraph(rows, MODULES, null, [], null, null, options)
  const { pendingInstances, pendingEdges, conflicts, ivcZeroedHearts } = graph
  const nameOf = (id) => pendingInstances.find((node) => node.id === id).data.name
  const slots = Object.fromEntries(
    pendingEdges.map((edge) => [
      `${nameOf(edge.source)}>${nameOf(edge.target)}`,
      edge.data.couplings.map((c) => `${c.sourcePort.label}:${c.sourceSlot}>${c.targetSlot}`),
    ])
  )
  const { unmatched } = orderForCa(pendingInstances, pendingEdges)
  return { slots, conflicts, unmatched: unmatched.map((edge) => edge.id), nodes: pendingInstances, ivcZeroedHearts }
}

describe('buildWorkflowGraph port slots', () => {
  it("gives each edge its source's first free slot, whatever its place in out_instances", () => {
    const { slots, conflicts } = build([
      row('S', 'split:s', 'C A B'),
      row('A', 'vessel:v', '', 'S'),
      row('B', 'vessel:v', '', 'S'),
      row('C', 'sensor:c', '', 'S'),
    ])

    expect(slots).toEqual({ 'S>C': ['ctrl:0>0'], 'S>A': ['vessel_port:0>0'], 'S>B': ['vessel_port:1>0'] })
    expect(conflicts).toEqual([])
  })

  it("gives a target's slots in module-array order, as CA connects the rows", () => {
    const { slots } = build([
      row('J', 'join:j', '', 'X Y'),
      row('Y', 'vessel:v', 'J'),
      row('X', 'vessel:v', 'J'),
    ])

    expect(slots).toEqual({ 'Y>J': ['vessel_port:0>0'], 'X>J': ['vessel_port:0>1'] })
  })

  it('shares a multiport slot between edges', () => {
    const { slots, conflicts } = build([
      row('S', 'shared:s', 'A B'),
      row('A', 'vessel:v', '', 'S'),
      row('B', 'vessel:v', '', 'S'),
    ])

    expect(slots).toEqual({ 'S>A': ['vessel_port:0>0'], 'S>B': ['vessel_port:0>0'] })
    expect(conflicts).toEqual([])
  })

  it("holds a general port's slots as source and as target apart, as CA does, so export keeps them", () => {
    for (const middle of ['general:two', 'general:one']) {
      const { slots, conflicts, unmatched } = build([
        row('X', 'general:one', 'G'),
        row('G', middle, 'Y', 'X'),
        row('Y', 'general:one', '', 'G'),
      ])

      expect(slots).toEqual({ 'X>G': ['p:0>0'], 'G>Y': ['p:0>0'] })
      expect(conflicts).toEqual([])
      expect(unmatched).toEqual([])
    }
  })

  it('leaves out a conduit whose port has no free slot, and says why', () => {
    const { slots, conflicts } = build([
      row('S', 'single:s', 'A B'),
      row('A', 'vessel:v', '', 'S'),
      row('B', 'vessel:v', '', 'S'),
    ])

    expect(Object.keys(slots)).toEqual(['S>A'])
    expect(conflicts).toEqual([expect.stringMatching(/^S → B: "S" has no free "vessel_port" slot/)])
  })
})

describe("buildWorkflowGraph with circulatory_autogen's heart rule", () => {
  /**
   * Builds a heart fed by the given vessels, listed in inp_instances in that order but connected in the reverse order,
   * with two outputs unless told otherwise.
   *
   * @param {string[]} inputs
   * @param {Object} [options]
   * @param {string} [options.outputs] - The heart's out_instances.
   * @param {boolean} [options.caRules=true]
   * @returns {{ slots: Object, ivcFlow: *, unmatched: Array<string>, ivcZeroedHearts: string[] }}
   */
  function buildHeart(inputs, { outputs = 'aorta par', caRules = true } = {}) {
    const rows = [
      row('heart', 'heart:vp', outputs, inputs.join(' ')),
      ...[...inputs].reverse().map((name) => row(name, 'single:s', 'heart')),
      ...outputs.split(' ').filter(Boolean).map((name) => row(name, 'vessel:v', '', 'heart')),
    ]
    const { slots, unmatched, nodes, ivcZeroedHearts } = build(rows, { caRules })
    const heart = nodes.find((node) => node.data.name === 'heart')
    const toHeart = Object.fromEntries(Object.entries(slots).filter(([key]) => key.endsWith('>heart')))
    const ivcFlow = heart.data.variables.find((v) => v.name === 'v_ivc').value
    return { slots: toHeart, ivcFlow, unmatched, ivcZeroedHearts }
  }

  it('gives three inputs the ivc, svc and pulmonary slots of their place in inp_instances', () => {
    const { slots, ivcFlow, unmatched, ivcZeroedHearts } = buildHeart(['venous_ivc', 'venous_svc', 'pvn'])
    expect(slots).toEqual({
      'pvn>heart': ['vessel_port:0>2'],
      'venous_svc>heart': ['vessel_port:0>1'],
      'venous_ivc>heart': ['vessel_port:0>0'],
    })
    expect(ivcFlow).toBeNull()
    expect(ivcZeroedHearts).toEqual([])
    expect(unmatched).toEqual([])
  })

  it('gives two inputs the svc and pulmonary slots, and the heart no ivc flow, as CA feeds it zero_flow', () => {
    const { slots, ivcFlow, unmatched, ivcZeroedHearts } = buildHeart(['venous_svc', 'pvn'])
    expect(slots).toEqual({ 'pvn>heart': ['vessel_port:0>2'], 'venous_svc>heart': ['vessel_port:0>1'] })
    expect(ivcFlow).toBe('0')
    expect(ivcZeroedHearts).toEqual(['heart'])
    expect(unmatched).toEqual([])
  })

  it('counts the pulmonary vein CA adds to a heart with one output', () => {
    const { slots, ivcFlow } = buildHeart(['venous_svc'], { outputs: 'aorta' })
    expect(slots).toEqual({ 'venous_svc>heart': ['vessel_port:0>1'] })
    expect(ivcFlow).toBe('0')
  })

  it("takes the first free slots without CA's rules, as for a CellML import", () => {
    const { slots, ivcFlow, ivcZeroedHearts } = buildHeart(['venous_svc', 'pvn'], { caRules: false })
    expect(slots).toEqual({ 'pvn>heart': ['vessel_port:0>0'], 'venous_svc>heart': ['vessel_port:0>1'] })
    expect(ivcFlow).toBeNull()
    expect(ivcZeroedHearts).toEqual([])
  })
})
