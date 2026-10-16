/**
 * A small nested workspace graph for save, load and snapshot tests: modules with handles, a super-module with local
 * constants, a subsystem with overrides (its '@' included), an internal edge and an exposure edge.
 */
import { expandHierarchy } from '../../../../src/services/hierarchy/expand.js'
import { connect, constant, exposed, exposures, module, port, subsystem, supermodule } from './graph.js'

/** A handle. */
export const handle = (uid, type, side, variant = 'default') => ({ uid, type, side, variant, slotIndex: 0, name: '' })

/** A ghost handle. */
export const ghost = (uid, side) => ({ uid, side, variant: 'ghost', slotIndex: 1, name: '' })

/** A vessel-like module with an entrance and an exit `vessel` port, its own handles and constant k. */
export const vessel = (localId, name, scope = null) =>
  module(localId, name, {
    scope,
    ports: [port('entrance_ports', 'vessel', ['q']), port('exit_ports', 'vessel', ['q'])],
    variables: [constant('k', '1')],
    data: { handles: [handle(`${localId}_in`, 'target', 'left'), handle(`${localId}_out`, 'source', 'right'), ghost(`${localId}_g`, 'right')] },
  })

/**
 * src → p1 → sink at the root, p1 a subsystem of 'pair' (a → b inside), whose exposure edges expose a's entrance and
 * b's exit.
 */
export function nestedGraph() {
  const a = vessel('a', 'a', 'sm_1')
  const b = vessel('b', 'b', 'sm_1')
  const sm = supermodule('sm_1', 'pair', {
    submoduleOrder: ['a', 'b'],
    localConstants: [{ name: 'g', units: 'dimensionless', value: '1', data_reference: null }],
  })
  sm.data.handles = [handle('sm_1_in', 'target', 'left'), handle('sm_1_out', 'source', 'right')]
  // As the canvas draws them, from each child's handle to the interface's.
  const [toA, toB] = exposures('sm_1', [exposed('xp_in', 'a', 'entrance_ports', 'vessel'), exposed('xp_out', 'b', 'exit_ports', 'vessel')])
  const exposure = [
    { ...toA, sourceHandle: 'handle_a_out', targetHandle: 'handle_sm_1_in' },
    { ...toB, sourceHandle: 'handle_b_out', targetHandle: 'handle_sm_1_in' },
  ]
  const p1 = subsystem({ nodes: [sm, a, b], edges: exposure }, 'dndnode_1', 'p1', 'sm_1', {
    overrides: { a: { k: { value: '2' } }, '@': { g: { value: '3' } } },
  })
  p1.data.handles = [handle('p1_in', 'target', 'left'), handle('p1_out', 'source', 'right')]
  const src = vessel('dndnode_0', 'src')
  const sink = vessel('dndnode_2', 'sink')
  const withHandles = (edge, sourceHandle, targetHandle) => ({ ...edge, sourceHandle, targetHandle })
  const edges = [
    withHandles(connect(src, p1, { id: 'e0' }), 'handle_dndnode_0_out', 'handle_p1_in'),
    withHandles(connect(p1, sink, { id: 'e1' }), 'handle_p1_out', 'handle_dndnode_2_in'),
    // As the app ids them: `${source}--${target}`, and an exposure edge's port after.
    withHandles(connect(a, b), 'handle_a_out', 'handle_b_in'),
    ...exposure,
  ]
  return { nodes: [src, p1, sink, sm, a, b], edges }
}

/** The model a graph stands for, as names, rows and couplings. */
export function modelOf({ nodes, edges }) {
  const expansion = expandHierarchy(nodes, edges)
  const nameOf = new Map(expansion.nodes.map((node) => [node.id, node.data.name]))
  return {
    nodes: expansion.nodes.map((node) => ({ name: node.data.name, variables: node.data.variables, ports: node.data.ports })),
    edges: expansion.edges.map((edge) => ({
      source: nameOf.get(edge.source),
      target: nameOf.get(edge.target),
      couplings: edge.data.couplings.map(({ sourcePort, targetPort }) => [sourcePort.label, targetPort.label]),
    })),
  }
}
