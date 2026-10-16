/**
 * PhLynx-authored nested workspaces for the native circulatory_autogen export, built from the bundled modules (see
 * fixtures/hierarchy/equivalence.js moduleFactory).
 */
import { connect, exposed, exposures, superInstance, supermodule } from '../hierarchy/graph.js'

/** Gives a super-module node a circulatory_autogen identity, as the export's prompt stores it. */
export const named = (node, module_type, module_subtype = 'phlynx_v1') => {
  node.data.supermodule.ca = { module_type, module_subtype }
  return node
}

/**
 * Two levels CA can express: an aorta feeds leg (limb: art → bed → vein), bed a capillary_bed (cap) inside it, and leg
 * drains into vc. limb exposes art's inlet and vein's outlet, both its own modules'. limb sets bed's cap R_T, and leg
 * sets it again, which wins, as well as art's R.
 *
 * @param {Function} make - From moduleFactory.
 * @param {Object} [options]
 * @param {boolean} [options.identities=true] - Whether the super-modules have circulatory_autogen identities.
 * @returns {{nodes: Array, edges: Array}}
 */
export function nestedLimb(make, { identities = true } = {}) {
  // The venous modules' volume and compliance changes off, which divide by zero otherwise.
  const steady = { values: { Delta_q_us: '0', Delta_C: '0' } }
  const cap = make('cap', 'cap', 'terminal:pp', { scope: 'sm_2' })
  const bedsm = supermodule('sm_2', 'capillary_bed', { submoduleOrder: ['cap'] })
  const bedExposure = exposures('sm_2', [exposed('xp_in', 'cap', 'entrance_ports', 'vessel_port'), exposed('xp_out', 'cap', 'exit_ports', 'vessel_port')])
  const art = make('art', 'art', 'arterial_simple:pv', { scope: 'sm_1' })
  const vein = make('vein', 'vein', 'venous:vp', { scope: 'sm_1', ...steady })
  const bed = superInstance({ nodes: [bedsm, cap], edges: bedExposure }, 'bed', 'bed', 'sm_2', { scope: 'sm_1', overrides: { cap: { R_T: { value: '2' } } } })
  const limb = supermodule('sm_1', 'limb', { submoduleOrder: ['art', 'bed', 'vein'] })
  const exposure = [
    ...exposures('sm_1', [exposed('xp_a', 'art', 'entrance_ports', 'vessel_port'), exposed('xp_v', 'vein', 'exit_ports', 'vessel_port')]),
    ...bedExposure,
  ]
  if (identities) {
    named(limb, 'limb')
    named(bedsm, 'capillary_bed')
  }
  const inner = [limb, art, bed, vein, bedsm, cap]
  const internalUsed = new Set()
  const internal = [connect(art, bed, { used: internalUsed }), connect(bed, vein, { used: internalUsed })]
  const leg = superInstance({ nodes: inner, edges: exposure }, 'dndnode_1', 'leg', 'sm_1', {
    overrides: { 'bed/cap': { R_T: { value: '3' } }, art: { R: { value: '4' } } },
  })
  const aorta = make('dndnode_0', 'aorta', 'arterial_simple:pv')
  const vc = make('dndnode_2', 'vc', 'venous:vp', steady)
  const used = new Set()
  return {
    nodes: [aorta, leg, vc, ...inner],
    edges: [connect(aorta, leg, { used, id: 'e0' }), connect(leg, vc, { used, id: 'e1' }), ...internal, ...exposure],
  }
}
