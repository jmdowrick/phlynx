/**
 * Tanks draining through Sum ports into branches and drains: small models with an ODE, built from their own CellML, for
 * the CellML export with imports.
 */
import { analyzeMathXml } from '../../../../src/services/math/analyzeMath.js'
import { reconcileRows } from '../../../../src/services/math/reconcileRows.js'
import { MAIN_NODE_TYPE } from '../../../../src/utils/constants.js'
import { nodeIdOf } from '../../../../src/utils/hierarchy.js'
import { connect, superInstance, supermodule } from './graph.js'

export const TANK_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="tank">
  <component name="tank">
    <variable name="t" units="second" interface="public"/>
    <variable name="q" units="dimensionless" initial_value="q_init" interface="public"/>
    <variable name="q_init" units="dimensionless" initial_value="1" interface="public"/>
    <variable name="v_sum" units="per_second" interface="public"/>
    <variable name="u" units="dimensionless" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>q</ci></apply><apply><minus/><ci>v_sum</ci></apply></apply>
      <apply><eq/><ci>u</ci><ci>q</ci></apply>
    </math>
  </component>
</model>`
export const DRAIN_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="drain">
  <component name="drain">
    <variable name="u" units="dimensionless" interface="public"/>
    <variable name="v" units="per_second" interface="public"/>
    <variable name="k" units="per_second" initial_value="0.5" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>v</ci><apply><times/><ci>k</ci><ci>u</ci></apply></apply></math>
  </component>
</model>`

/**
 * A super-module whose own maths is its self leaf (#364): a tank draining through its Sum port into a child drain, used
 * twice, each super instance with its own k and starting volume.
 */
export function selfLeafTanks(store) {
  store.addUnitsFile({ componentFile: 'per_second.cellml', model: '<model xmlns="http://www.cellml.org/cellml/2.0#" name="u"><units name="per_second"><unit units="second" exponent="-1"/></units></model>' })
  store.addMath('file:tank', TANK_XML)
  store.addMath('file:drain', DRAIN_XML)
  const build = (localId, name, mathRef, ports, data = {}) => {
    const portVariables = new Set(ports.flatMap((port) => port.variables))
    const rows = reconcileRows(analyzeMathXml(store.availableMath.get(mathRef)), [], { defaults: store.getMathDefaults(mathRef) }).map((row) => ({
      ...row,
      type: row.type === 'constant' && portVariables.has(row.name) ? 'boundary_condition' : row.type,
    }))
    return { id: nodeIdOf('sm_1', localId), type: MAIN_NODE_TYPE, data: { scope: 'sm_1', localId, name, mathRef, variables: rows, ports, ...data } }
  }
  const tank = build('tank', 'tank', 'file:tank', [{ portType: 'exit_ports', label: 'vessel', variables: ['v_sum', 'u'], multiportType: ['sum', 'True'] }], { role: 'self' })
  const drain = build('drain', 'drain', 'file:drain', [{ portType: 'entrance_ports', label: 'vessel', variables: ['v', 'u'], multiportType: 'None' }])
  const sm = supermodule('sm_1', 'reservoir', { submoduleOrder: ['tank', 'drain'] })
  const inner = [sm, tank, drain]
  const instances = [
    superInstance(inner, 'dndnode_0', 'p1', 'sm_1', { overrides: { drain: { k: { value: '0.25' } } } }),
    superInstance(inner, 'dndnode_1', 'p2', 'sm_1', { overrides: { tank: { q_init: { value: '2' } } } }),
  ]
  return { nodes: [...instances, ...inner], edges: [connect(tank, drain, { id: 'e_int' })] }
}

export const BRANCH_G_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="branch">
  <component name="branch">
    <variable name="u" units="dimensionless" interface="public"/>
    <variable name="v" units="per_second" interface="public"/>
    <variable name="k" units="per_second" initial_value="0.5" interface="public"/>
    <variable name="g" units="dimensionless" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>v</ci><apply><times/><ci>g</ci><ci>k</ci><ci>u</ci></apply></apply></math>
  </component>
</model>`

/**
 * Builds tanks (TANK_XML, draining through a Sum port) and branches (v = g·k·u, g a global constant 2), rows typed as
 * the canvas types them: a port's constants boundary conditions, `local` names local constants, `globals` global ones.
 */
export function tankKit(store) {
  store.addUnitsFile({ componentFile: 'per_second.cellml', model: '<model xmlns="http://www.cellml.org/cellml/2.0#" name="u"><units name="per_second"><unit units="second" exponent="-1"/></units></model>' })
  store.addMath('file:tank', TANK_XML)
  store.addMath('file:branch_g', BRANCH_G_XML)
  store.assignGlobalConstant('g', '2', 'dimensionless', 'test')
  const build = (mathRef, ports) => (localId, name, { scope = null, values = {}, local = [], globals = ['g'], role } = {}) => {
    const portVariables = new Set(ports.flatMap((port) => port.variables))
    const typeOf = (row) =>
      globals.includes(row.name) ? 'global_constant' : local.includes(row.name) ? 'local_constant' : row.type === 'constant' && portVariables.has(row.name) ? 'boundary_condition' : row.type
    const rows = reconcileRows(analyzeMathXml(store.availableMath.get(mathRef)), [], { defaults: store.getMathDefaults(mathRef) }).map((row) => ({
      ...row,
      type: typeOf(row),
      ...(row.name in values && { value: values[row.name] }),
    }))
    const data = { scope, localId, name, mathRef, variables: rows, ports: structuredClone(ports), ...(role && { role }) }
    return { id: nodeIdOf(scope, localId), type: MAIN_NODE_TYPE, data }
  }
  return {
    module: build,
    tank: build('file:tank', [{ portType: 'exit_ports', label: 'vessel', variables: ['v_sum', 'u'], multiportType: ['sum', 'True'] }]),
    branch: build('file:branch_g', [{ portType: 'entrance_ports', label: 'vessel', variables: ['v', 'u'], multiportType: 'None' }]),
  }
}
