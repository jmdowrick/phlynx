// @vitest-environment happy-dom
import createLibOpenCOR from '@opencor/libopencor'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { analyzeMathXml } from '../../../../src/services/math/analyzeMath.js'
import { reconcileRows } from '../../../../src/services/math/reconcileRows.js'
import { canonicalModel, compareCanonical, compareSimulations } from '../../../../src/services/testing/modelCompare.js'
import { useLibraryStore } from '../../../../src/stores/libraryStore.js'
import { areModelsEquivalent, generateFlattenedModel } from '../../../../src/utils/cellml.js'
import { resolvePortCouplings } from '../../../../src/utils/edges.js'
import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'

const UNITS = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="units">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
</model>`
const HUB_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="hub">
  <component name="hub">
    <variable name="t" units="second" interface="public"/>
    <variable name="q" units="dimensionless" initial_value="q_init" interface="public"/>
    <variable name="q_init" units="dimensionless" initial_value="1" interface="public"/>
    <variable name="v_sum" units="per_second" interface="public"/>
    <variable name="u" units="dimensionless" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>q</ci></apply>
        <apply><minus/><ci>v_sum</ci></apply>
      </apply>
      <apply><eq/><ci>u</ci><ci>q</ci></apply>
    </math>
  </component>
</model>`
const LEAF_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="leaf">
  <component name="leaf">
    <variable name="u" units="dimensionless" interface="public"/>
    <variable name="v" units="per_second" interface="public"/>
    <variable name="k" units="per_second" initial_value="0.5" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><ci>v</ci><apply><times/><ci>k</ci><ci>u</ci></apply></apply>
    </math>
  </component>
</model>`

/**
 * Wraps components and connections in a CellML 2.0 model.
 *
 * @param {string} content
 * @returns {string}
 */
const model = (content) => `<?xml version="1.0"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" xmlns:cellml="http://www.cellml.org/cellml/2.0#" name="m">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
  ${content}
</model>`
const math = (content) => `<math xmlns="http://www.w3.org/1998/Math/MathML">${content}</math>`
const connection = (c1, c2, ...pairs) =>
  `<connection component_1="${c1}" component_2="${c2}">${pairs.map(([v1, v2]) => `<map_variables variable_1="${v1}" variable_2="${v2}"/>`).join('')}</connection>`

// dx/dt = -k * x, with t from environment and k from params.
const ENVIRONMENT = `<component name="environment"><variable name="t" units="second" interface="public"/></component>`
const PARAMS = `<component name="params"><variable name="k" units="per_second" initial_value="0.5" interface="public"/></component>`
const decay = ({ name = 'decay', initial = '1', units = 'dimensionless', rhs = '<apply><minus/><apply><times/><ci>k</ci><ci>x</ci></apply></apply>' } = {}) => `<component name="${name}">
    <variable name="t" units="second" interface="public"/>
    <variable name="k" units="per_second" interface="public"/>
    <variable name="x" units="${units}" initial_value="${initial}" interface="public"/>
    <variable name="y" units="${units}" interface="public"/>
    ${math(`<apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>${rhs}</apply>
      <apply><eq/><ci>y</ci><apply><times/><cn cellml:units="dimensionless">2.0</cn><ci>x</ci></apply></apply>`)}
  </component>`
const DECAY = model(`${ENVIRONMENT}${PARAMS}${decay()}
  ${connection('environment', 'decay', ['t', 't'])}${connection('params', 'decay', ['k', 'k'])}`)

describe('canonicalModel and compareCanonical', () => {
  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  it('compares a model with itself as equal', () => {
    expect(compareCanonical(DECAY, DECAY)).toEqual({ equal: true, differences: [] })
  })

  it('compares components, variables, connections and equations in another order, and maths written differently, as equal', () => {
    // The equations swapped, 2.0 * x as x * 2, the connections and components reversed.
    const reordered = model(`${connection('decay', 'params', ['k', 'k'])}${connection('decay', 'environment', ['t', 't'])}
      <component name="decay">
        <variable name="y" units="dimensionless" interface="public"/>
        <variable name="x" units="dimensionless" initial_value="1.0" interface="public"/>
        <variable name="k" units="per_second" interface="public"/>
        <variable name="t" units="second" interface="public"/>
        ${math(`<apply><eq/><ci> y </ci><apply><times/><ci>x</ci><cn cellml:units="dimensionless">2</cn></apply></apply>
          <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><apply><minus/><apply><times/><ci>x</ci><ci>k</ci></apply></apply></apply>`)}
      </component>${PARAMS}${ENVIRONMENT}`)
    expect(areModelsEquivalent(DECAY, reordered)).toBe(false)
    expect(compareCanonical(DECAY, reordered)).toEqual({ equal: true, differences: [] })
  })

  it('compares renamed components as equal through a rename map, and names them otherwise', () => {
    const renamed = model(`${ENVIRONMENT.replace('"environment"', '"env"')}${PARAMS.replace('"params"', '"parameters"')}${decay({ name: 'tank_1' })}
      ${connection('env', 'tank_1', ['t', 't'])}${connection('parameters', 'tank_1', ['k', 'k'])}`)
    const rename = { env: 'environment', parameters: 'params', tank_1: 'decay' }
    expect(compareCanonical(DECAY, renamed, { renameB: rename })).toEqual({ equal: true, differences: [] })
    expect(compareCanonical(DECAY, renamed, { renameB: (name) => rename[name] })).toEqual({ equal: true, differences: [] })
    // Renamed both ways, to names of neither.
    const toCommon = new Map([['decay', 'c'], ['tank_1', 'c']])
    expect(compareCanonical(DECAY, renamed, { renameA: toCommon, renameB: { ...rename, tank_1: 'c' } }).equal).toBe(true)

    const { equal, differences } = compareCanonical(DECAY, renamed)
    expect(equal).toBe(false)
    expect(differences).toEqual(expect.arrayContaining(['component decay: only in A', 'component tank_1: only in B', 'component env: only in B']))
  })

  it('refuses a rename map that gives two components one name', () => {
    expect(() => canonicalModel(DECAY, { rename: { params: 'decay' } })).toThrow(/both compare as "decay"/)
  })

  it('renames variables, in equations and connections too', () => {
    const renamed = DECAY.replaceAll('<ci>x</ci>', '<ci>s</ci>').replace('name="x"', 'name="s"')
    const renameVariableB = (component, variable) => (component === 'decay' && variable === 's' ? 'x' : variable)
    expect(compareCanonical(DECAY, renamed).equal).toBe(false)
    expect(compareCanonical(DECAY, renamed, { renameVariableB })).toEqual({ equal: true, differences: [] })
  })

  it('compares connection topologies giving the same equivalent variables as equal', () => {
    // Three decays sharing params' k: a star from params, or a chain through them.
    const shared = `${ENVIRONMENT}${PARAMS}${decay({ name: 'a' })}${decay({ name: 'b' })}${decay({ name: 'c' })}
      ${connection('environment', 'a', ['t', 't'])}${connection('environment', 'b', ['t', 't'])}${connection('environment', 'c', ['t', 't'])}`
    const star = model(`${shared}${connection('params', 'a', ['k', 'k'])}${connection('params', 'b', ['k', 'k'])}${connection('params', 'c', ['k', 'k'])}`)
    const chain = model(`${shared}${connection('params', 'a', ['k', 'k'])}${connection('a', 'b', ['k', 'k'])}${connection('c', 'b', ['k', 'k'])}`)
    expect(areModelsEquivalent(star, chain)).toBe(false)
    expect(compareCanonical(star, chain)).toEqual({ equal: true, differences: [] })
    expect(canonicalModel(star).equivalences).toContainEqual(['a/k', 'b/k', 'c/k', 'params/k'])

    // c's k left out of the set.
    const apart = model(`${shared}${connection('params', 'a', ['k', 'k'])}${connection('a', 'b', ['k', 'k'])}
      <component name="other"><variable name="k" units="per_second" initial_value="0.5" interface="public"/></component>${connection('other', 'c', ['k', 'k'])}`)
    const { equal, differences } = compareCanonical(star, apart)
    expect(equal).toBe(false)
    expect(differences).toEqual(
      expect.arrayContaining([
        'equivalent variables only in A: {a/k, b/k, c/k, params/k}',
        'equivalent variables only in B: {a/k, b/k, params/k}',
        'equivalent variables only in B: {c/k, other/k}',
      ])
    )
  })

  it('names a changed equation', () => {
    const changed = model(`${ENVIRONMENT}${PARAMS}${decay({ rhs: '<apply><times/><ci>k</ci><ci>x</ci></apply>' })}
      ${connection('environment', 'decay', ['t', 't'])}${connection('params', 'decay', ['k', 'k'])}`)
    const { equal, differences } = compareCanonical(DECAY, changed)
    expect(equal).toBe(false)
    expect(differences).toEqual([
      'component decay: equation only in A: eq(diff(bvar(t), x), minus(times(k, x)))',
      'component decay: equation only in B: eq(diff(bvar(t), x), times(k, x))',
    ])
  })

  it('tells operands of operators that are not commutative apart', () => {
    const swapped = DECAY.replace('<apply><minus/><apply><times/><ci>k</ci><ci>x</ci></apply></apply>', '<apply><minus/><ci>x</ci><ci>k</ci></apply>')
    const reversed = DECAY.replace('<apply><minus/><apply><times/><ci>k</ci><ci>x</ci></apply></apply>', '<apply><minus/><ci>k</ci><ci>x</ci></apply>')
    expect(compareCanonical(swapped, reversed).equal).toBe(false)
    expect(compareCanonical(swapped, reversed, { sortCommutative: false }).equal).toBe(false)
  })

  it('keeps the order of a piecewise, whose overlapping conditions make it matter', () => {
    const piece = (value, above) => `<piece><cn cellml:units="dimensionless">${value}</cn><apply><gt/><ci>x</ci><cn cellml:units="dimensionless">${above}</cn></apply></piece>`
    const piecewise = (...pieces) =>
      DECAY.replace(/<apply><eq\/><ci>y<\/ci>.*?<\/apply><\/apply>/s, `<apply><eq/><ci>y</ci><piecewise>${pieces.join('')}<otherwise><cn cellml:units="dimensionless">0</cn></otherwise></piecewise></apply>`)
    expect(compareCanonical(piecewise(piece(1, 0), piece(2, 1)), piecewise(piece(2, 1), piece(1, 0))).equal).toBe(false)
  })

  it('tells a constant from a variable of its name', () => {
    const withPi = DECAY.replace('<variable name="y"', '<variable name="pi" units="dimensionless" initial_value="3"/><variable name="y"')
    const usingVariable = withPi.replace('<cn cellml:units="dimensionless">2.0</cn>', '<ci>pi</ci>')
    const usingConstant = withPi.replace('<cn cellml:units="dimensionless">2.0</cn>', '<pi/>')
    expect(compareCanonical(usingVariable, usingConstant).differences).toEqual([
      'component decay: equation only in A: eq(times(pi, x), y)',
      'component decay: equation only in B: eq(times(#pi, x), y)',
    ])
  })

  it('compares resets', () => {
    const reset = (value) =>
      `<reset variable="x" test_variable="x" order="1"><test_value>${math('<cn cellml:units="dimensionless">5</cn>')}</test_value><reset_value>${math(`<cn cellml:units="dimensionless">${value}</cn>`)}</reset_value></reset>`
    const withReset = (value) => DECAY.replace(/(<component name="decay">[\s\S]*?)(<\/component>)/, `$1${reset(value)}$2`)
    expect(compareCanonical(withReset('0'), withReset('0.0')).equal).toBe(true)
    expect(compareCanonical(DECAY, withReset('0')).differences).toEqual(['component decay: reset x to 0[dimensionless] when x = 5[dimensionless] (order 1) only in B'])
    expect(compareCanonical(withReset('0'), withReset('1')).equal).toBe(false)
  })

  it('names a changed initial value', () => {
    const changed = model(`${ENVIRONMENT}${PARAMS}${decay({ initial: '1.5' })}
      ${connection('environment', 'decay', ['t', 't'])}${connection('params', 'decay', ['k', 'k'])}`)
    expect(compareCanonical(DECAY, changed)).toEqual({ equal: false, differences: ['component decay: variable x has initial value 1 in A, 1.5 in B'] })
  })

  it("names a changed variable's units, and a changed units definition", () => {
    const changed = model(`${ENVIRONMENT}${PARAMS}${decay({ units: 'metre' })}
      ${connection('environment', 'decay', ['t', 't'])}${connection('params', 'decay', ['k', 'k'])}`)
    const { equal, differences } = compareCanonical(DECAY, changed)
    expect(equal).toBe(false)
    expect(differences).toEqual(['component decay: variable x has units dimensionless in A, metre in B', 'component decay: variable y has units dimensionless in A, metre in B'])

    const redefined = DECAY.replace('<unit units="second" exponent="-1"/>', '<unit units="second" prefix="milli" exponent="-1"/>')
    expect(compareCanonical(DECAY, redefined).differences).toEqual([
      'units per_second: [second prefix=0 exponent=-1 multiplier=1] in A, [second prefix=-3 exponent=-1 multiplier=1] in B',
    ])
    expect(compareCanonical(DECAY, redefined, { ignore: ['units'] }).equal).toBe(true)
    // A prefix by name or by power of ten.
    expect(compareCanonical(redefined, redefined.replace('prefix="milli"', 'prefix="-3"')).equal).toBe(true)
  })

  it('names a changed interface unless ignored', () => {
    const changed = DECAY.replace('<variable name="y" units="dimensionless" interface="public"/>', '<variable name="y" units="dimensionless"/>')
    expect(compareCanonical(DECAY, changed).differences).toEqual(['component decay: variable y has interface public in A, none in B'])
    expect(compareCanonical(DECAY, changed, { ignore: ['interface'] }).equal).toBe(true)
  })

  it('compares encapsulation unless ignored', () => {
    const encapsulated = DECAY.replace('</model>', '<encapsulation><component_ref component="decay"><component_ref component="params"/></component_ref></encapsulation></model>')
    expect(compareCanonical(DECAY, encapsulated).differences).toEqual(['encapsulation only in B: decay > params'])
    expect(compareCanonical(DECAY, encapsulated, { ignore: ['encapsulation'] }).equal).toBe(true)
  })

  it('flattens imports before comparing', () => {
    const library = model(decay())
    const importing = model(`${ENVIRONMENT}${PARAMS}
      <import xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="library.cellml"><component name="decay" component_ref="decay"/></import>
      ${connection('environment', 'decay', ['t', 't'])}${connection('params', 'decay', ['k', 'k'])}`)
    expect(compareCanonical(DECAY, importing, { importSources: { 'library.cellml': library } })).toEqual({ equal: true, differences: [] })
    expect(() => canonicalModel(importing)).toThrow(/importSources/)
  })

  it('accepts canonical forms in place of CellML', () => {
    expect(compareCanonical(canonicalModel(DECAY), DECAY).equal).toBe(true)
  })
})

describe('PhLynx exports', () => {
  let store
  let libOpenCOR

  beforeAll(async () => {
    await ensureLibCellmlReady()
    // One libOpenCOR for the file: a second instance in the same page breaks the first.
    libOpenCOR = await createLibOpenCOR()
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    store.addUnitsFile({ componentFile: 'units.cellml', model: UNITS })
    store.addMath('file:hub', HUB_XML)
    store.addMath('file:leaf', LEAF_XML)
    // The library analyses its math on the main thread here, and says so.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  /** A node built from the stored math, its port inputs typed as boundary conditions. */
  function buildNode(id, mathRef, ports, values = {}) {
    const portVariables = new Set(ports.flatMap((port) => port.variables))
    const rows = reconcileRows(analyzeMathXml(store.availableMath.get(mathRef)), [], { defaults: store.getMathDefaults(mathRef) }).map((row) => ({
      ...row,
      type: row.type === 'constant' && portVariables.has(row.name) ? 'boundary_condition' : row.type,
      ...(row.name in values && { value: values[row.name] }),
    }))
    return { id, type: 'instanceNode', data: { name: id, mathRef, variables: rows, ports } }
  }

  /** A hub draining into two leaves through a Sum port, each leaf with its own k. */
  function buildNetwork({ k2 = '0.25' } = {}) {
    const hub = buildNode('hub', 'file:hub', [{ portType: 'exit_ports', label: 'vessel', variables: ['v_sum', 'u'], multiportType: ['sum', 'True'] }])
    const leaves = [
      ['leaf_1', '0.5'],
      ['leaf_2', k2],
    ].map(([id, k]) => buildNode(id, 'file:leaf', [{ portType: 'entrance_ports', label: 'vessel', variables: ['v', 'u'], multiportType: 'None' }], { k }))
    const edges = leaves.map((leaf) => ({ id: `hub_${leaf.id}`, source: 'hub', target: leaf.id, data: { couplings: resolvePortCouplings(hub.data.ports, leaf.data.ports) } }))
    return { nodes: [hub, ...leaves], edges }
  }

  const exportOf = async (nodes, edges) => (await generateFlattenedModel(nodes, edges, store)).text()

  // The network written by hand: its own component order and names, the leaves' u chained rather than each taken
  // from the hub, and the summation's terms named and added in another order.
  const HAND_FLAT = `<?xml version="1.0"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="hand_flat">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
  <component name="sums">
    <variable name="total" units="per_second" interface="public"/>
    <variable name="from_2" units="per_second" interface="public"/>
    <variable name="from_1" units="per_second" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>total</ci><apply><plus/><ci>from_2</ci><ci>from_1</ci></apply></apply></math>
  </component>
  <component name="leaf_2">
    <variable name="k" units="per_second" interface="public"/>
    <variable name="u" units="dimensionless" interface="public"/>
    <variable name="v" units="per_second" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>v</ci><apply><times/><ci>u</ci><ci>k</ci></apply></apply></math>
  </component>
  <component name="leaf_1">
    <variable name="u" units="dimensionless" interface="public"/>
    <variable name="v" units="per_second" interface="public"/>
    <variable name="k" units="per_second" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>v</ci><apply><times/><ci>k</ci><ci>u</ci></apply></apply></math>
  </component>
  <component name="hub">
    <variable name="u" units="dimensionless" interface="public"/>
    <variable name="v_sum" units="per_second" interface="public"/>
    <variable name="q_init" units="dimensionless" interface="public"/>
    <variable name="q" units="dimensionless" initial_value="q_init" interface="public"/>
    <variable name="t" units="second" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><ci>q</ci><ci>u</ci></apply>
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>q</ci></apply><apply><minus/><ci>v_sum</ci></apply></apply>
    </math>
  </component>
  <component name="parameters">
    <variable name="leaf_2_k" units="per_second" initial_value="0.25" interface="public"/>
    <variable name="leaf_1_k" units="per_second" initial_value="0.50" interface="public"/>
    <variable name="q_init" units="dimensionless" initial_value="1" interface="public"/>
  </component>
  <component name="environment"><variable name="t" units="second" interface="public"/></component>
  <connection component_1="leaf_1" component_2="leaf_2"><map_variables variable_1="u" variable_2="u"/></connection>
  <connection component_1="hub" component_2="leaf_1"><map_variables variable_1="u" variable_2="u"/></connection>
  <connection component_1="sums" component_2="leaf_1"><map_variables variable_1="from_1" variable_2="v"/></connection>
  <connection component_1="sums" component_2="leaf_2"><map_variables variable_1="from_2" variable_2="v"/></connection>
  <connection component_1="sums" component_2="hub"><map_variables variable_1="total" variable_2="v_sum"/></connection>
  <connection component_1="parameters" component_2="leaf_2"><map_variables variable_1="leaf_2_k" variable_2="k"/></connection>
  <connection component_1="parameters" component_2="leaf_1"><map_variables variable_1="leaf_1_k" variable_2="k"/></connection>
  <connection component_1="parameters" component_2="hub"><map_variables variable_1="q_init" variable_2="q_init"/></connection>
  <connection component_1="hub" component_2="environment"><map_variables variable_1="t" variable_2="t"/></connection>
</model>`
  const HAND_FLAT_NAMES = { sums: 'generated_summations', parameters: 'instance_parameters' }
  const nameByConnection = ['generated_summations']

  it('compares an export of nodes and edges given in another order as equal, the summation named by its connections', async () => {
    const { nodes, edges } = buildNetwork()
    const exported = await exportOf(nodes, edges)
    const reordered = await exportOf([nodes[2], nodes[0], nodes[1]], [...edges].reverse())
    expect(areModelsEquivalent(exported, reordered)).toBe(false)

    expect(compareCanonical(exported, reordered, { nameByConnection })).toEqual({ equal: true, differences: [] })
    // Named as exported, the summation's terms follow the edges' order.
    const { equal, differences } = compareCanonical(exported, reordered)
    expect(equal).toBe(false)
    expect(differences).toContain('equivalent variables only in A: {generated_summations/op_v, leaf_1/v}')
  })

  it('compares an export with the network written flat by hand as equal', async () => {
    const { nodes, edges } = buildNetwork()
    const exported = await exportOf(nodes, edges)
    expect(compareCanonical(exported, HAND_FLAT, { renameB: HAND_FLAT_NAMES, nameByConnection })).toEqual({ equal: true, differences: [] })

    // A different k for leaf_2 is named.
    const changed = await exportOf(...Object.values(buildNetwork({ k2: '0.3' })))
    expect(compareCanonical(changed, HAND_FLAT, { renameB: HAND_FLAT_NAMES, nameByConnection }).differences).toEqual([
      'component instance_parameters: variable leaf_2_k has initial value 0.3 in A, 0.25 in B',
    ])
  })

  it('simulates an export and the network written by hand to the same trajectories', async () => {
    const { nodes, edges } = buildNetwork()
    const exported = await exportOf(nodes, edges)
    const result = await compareSimulations(exported, HAND_FLAT, { module: libOpenCOR, endTime: 2, renameB: HAND_FLAT_NAMES })
    expect(result.equal).toBe(true)
    expect(result.details.missing).toEqual([])
    expect(result.details.variables.map(({ name }) => name)).toEqual(['hub/q'])
    expect(result.maxError).toBeLessThan(1e-9)
    expect(result.details.pointCount).toEqual([101, 101])
  })

  it('compares named variables, and finds trajectories that differ', async () => {
    const exported = await exportOf(...Object.values(buildNetwork()))
    const changed = await exportOf(...Object.values(buildNetwork({ k2: '0.3' })))
    const result = await compareSimulations(exported, changed, { module: libOpenCOR, endTime: 2, variables: ['hub/q', 'leaf_2/v', ['leaf_1/v', 'leaf_1/v']] })
    expect(result.equal).toBe(false)
    expect(result.maxError).toBeGreaterThan(1e-3)
    const byName = Object.fromEntries(result.details.variables.map((entry) => [entry.name, entry]))
    expect(byName['hub/q']).toMatchObject({ equal: false, at: expect.any(Number) })
    expect(byName['leaf_2/v'].equal).toBe(false)
    expect(byName['leaf_1/v'].equal).toBe(false)

    // Within a loose enough tolerance, they agree.
    expect((await compareSimulations(exported, changed, { module: libOpenCOR, endTime: 2, tolerance: 0.5 })).equal).toBe(true)
  })

  it('names variables missing from either model', async () => {
    const exported = await exportOf(...Object.values(buildNetwork()))
    const result = await compareSimulations(exported, HAND_FLAT, { module: libOpenCOR, variables: ['instance_parameters/leaf_1_k'] })
    expect(result.equal).toBe(false)
    expect(result.maxError).toBe(Infinity)
    expect(result.details.missing).toEqual(['instance_parameters/leaf_1_k: "instance_parameters/leaf_1_k" not in B'])
  })
})
