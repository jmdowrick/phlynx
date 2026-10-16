/**
 * The workspaces behind tests/resources/ca/pairing*, whose CA exports circulatory_autogen itself generated (see
 * scripts/ca-pairing/generate_ca_pairing_reference.py).
 */
import { moduleFactory } from '../hierarchy/equivalence.js'
import { connect } from '../hierarchy/graph.js'
import { connect as coupled } from './workspace.js'

/** The new math one instance is saved to: arterial_simple:pv's, under another component. */
export const GOLDEN_MATH_REF = 'User_modules.cellml:pv_simple_copy_type'

/**
 * Adds the golden workspace's new math to a library holding the bundled modules.
 *
 * @param {Object} library
 */
export function addGoldenMath(library) {
  const math = library.availableMath.get('BG_modules.cellml:pv_simple_type').replace('name="pv_simple_type"', 'name="pv_simple_copy_type"')
  library.addMath(GOLDEN_MATH_REF, math)
  library.assignGlobalConstant('R', '1', 'Js_per_m6', 'test')
}

/** The index of a node's slot-th (portType, label) port. */
export const portIndex = (node, portType, label, slot = 0) =>
  node.data.ports.indexOf(node.data.ports.filter((p) => p.portType === portType && p.label === label)[slot])

/**
 * Builds the golden workspace: what the edge connection dialog can leave, on bundled modules whose boundary conditions
 * CA accepts. A split junction's first branch deleted, two flow sums whose slots two multiport sources fill in crossed
 * order, a label two connected modules share left uncoupled, a source entrance port coupled to a target general port
 * with fewer variables, a variable made global on one instance, and an instance on new math.
 *
 * @param {Object} library - With the bundled modules and addGoldenMath's.
 * @returns {{ nodes: Array, edges: Array }}
 */
export function goldenWorkspace(library) {
  const make = moduleFactory(library)
  const [a, split, b, c, d, e] = [
    make('n_a', 'a', 'arterial_simple:pv'),
    make('n_split', 'split', 'split_junction:pv'),
    make('n_b', 'b', 'arterial_simple:pv'),
    make('n_c', 'c', 'arterial_simple:pv'),
    make('n_d', 'd', 'arterial_simple:pv'),
    make('n_e', 'e', 'arterial_simple:pv'),
  ]
  const [s1, s2] = [make('n_s1', 's1', 'flow_sum_2:nn'), make('n_s2', 's2', 'flow_sum_2:nn')]

  const multiport = (node) => {
    node.data.ports = node.data.ports.map((p) => (p.portType === 'exit_ports' && p.label === 'flow_port' ? { ...p, multiportType: 'True' } : p))
  }
  multiport(b)
  multiport(c)
  b.data.ports = [...b.data.ports, { portType: 'entrance_ports', label: 'ctrl', variables: ['q', 'u'], multiportType: 'None' }]
  c.data.ports = [
    ...c.data.ports,
    { portType: 'general_ports', label: 'ctrl', variables: ['q_0'], multiportType: 'None' },
    { portType: 'entrance_ports', label: 'flow_port', variables: ['v'], multiportType: 'None' },
  ]
  c.data.variables = c.data.variables.map((row) => (row.name === 'R' ? { ...row, type: 'global_constant' } : row))
  e.data.mathRef = GOLDEN_MATH_REF

  const flow = (node) => portIndex(node, 'exit_ports', 'flow_port')
  const sumSlot = (node, slot) => portIndex(node, 'entrance_ports', 'flow_port', slot)
  const edges = [
    connect(a, split),
    coupled(split, b, [[portIndex(split, 'exit_ports', 'vessel_port', 1), portIndex(b, 'entrance_ports', 'vessel_port')]]),
    coupled(b, c, [
      [portIndex(b, 'exit_ports', 'vessel_port'), portIndex(c, 'entrance_ports', 'vessel_port')],
      [portIndex(b, 'entrance_ports', 'ctrl'), portIndex(c, 'general_ports', 'ctrl')],
    ]),
    connect(c, d),
    connect(d, e),
    coupled(b, s1, [[flow(b), sumSlot(s1, 0)]]),
    coupled(c, s1, [[flow(c), sumSlot(s1, 1)]]),
    coupled(b, s2, [[flow(b), sumSlot(s2, 1)]]),
    coupled(c, s2, [[flow(c), sumSlot(s2, 0)]]),
  ]
  return { nodes: [a, split, b, c, d, e, s1, s2], edges }
}

/**
 * Builds a workspace CA's terminal rule wires otherwise: a terminal into an arterial vessel taking flow at its inlet,
 * which gets the terminal's flow but not its pressure, as CA maps that into venous modules only.
 *
 * @param {Object} library - With the bundled modules.
 * @returns {{ nodes: Array, edges: Array }}
 */
export function terminalWorkspace(library) {
  const make = moduleFactory(library)
  const [p, t, a] = [make('n_p', 'p', 'arterial_simple:pv'), make('n_t', 't', 'terminal:pp'), make('n_a', 'a', 'arterial_simple:vp')]
  return { nodes: [p, t, a], edges: [connect(p, t), connect(t, a)] }
}

/**
 * The variable mappings the workspace's couplings make between its modules, as CA names them: each pair of a
 * coupling's variables, in order, as many as the shorter port has.
 *
 * @param {{ nodes: Array, edges: Array }} workspace
 * @returns {Array<string>} Sorted `<component>.<variable> = <component>.<variable>`, the two ends sorted.
 */
export function couplingMappings({ nodes, edges }) {
  const nameOf = new Map(nodes.map((node) => [node.id, node.data.name]))
  const mappings = new Set()
  for (const edge of edges) {
    for (const { sourcePort, targetPort } of edge.data.couplings) {
      const count = Math.min(sourcePort.variables.length, targetPort.variables.length)
      for (let i = 0; i < count; i++) {
        const ends = [`${nameOf.get(edge.source)}_module.${sourcePort.variables[i]}`, `${nameOf.get(edge.target)}_module.${targetPort.variables[i]}`]
        mappings.add(ends.sort().join(' = '))
      }
    }
  }
  return [...mappings].sort()
}
