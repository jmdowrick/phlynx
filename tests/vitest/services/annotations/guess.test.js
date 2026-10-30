import { describe, expect, it } from 'vitest'
import {
  checkPropertyUnits,
  findUnitsProperty,
  guessAnnotations,
  splitVariableName,
} from '../../../../src/services/annotations/guess.js'
import { analyzeMathXml } from '../../../../src/services/math/analyzeMath.js'
import { mergeUnitDefinitions } from '../../../../src/utils/units.js'

const UNITS = mergeUnitDefinitions([
  `<model xmlns="http://www.cellml.org/cellml/2.0#" name="units">
    <units name="mM"><unit prefix="milli" units="mole"/><unit units="litre" exponent="-1"/></units>
    <units name="mol_per_s"><unit units="mole"/><unit units="second" exponent="-1"/></units>
    <units name="fmol_per_mm2_per_s"><unit prefix="femto" units="mole"/><unit prefix="milli" units="metre" exponent="-2"/><unit units="second" exponent="-1"/></units>
    <units name="pA_per_mm2"><unit prefix="pico" units="ampere"/><unit prefix="milli" units="metre" exponent="-2"/></units>
    <units name="mV"><unit prefix="milli" units="volt"/></units>
    <units name="pL"><unit prefix="pico" units="litre"/></units>
    <units name="mm2"><unit prefix="milli" units="metre" exponent="2"/></units>
    <units name="per_s"><unit units="second" exponent="-1"/></units>
  </model>`,
])

/**
 * Guesses a module from its rows, as name:units pairs.
 *
 * @param {string[]} rows - e.g. 'c_Na:mM'.
 * @param {Object} [options] - More guessAnnotations input.
 * @returns {ReturnType<typeof guessAnnotations>}
 */
function guessRows(rows, options = {}) {
  return guessAnnotations({
    rows: rows.map((row) => {
      const [name, units] = row.split(':')
      return { name, units }
    }),
    unitDefinitions: UNITS,
    ...options,
  })
}

describe('splitVariableName', () => {
  it('splits a property prefix, a side suffix and the tokens between', () => {
    expect(splitVariableName('v_Na_NKA_i')).toEqual({ prefix: 'v', middle: ['Na', 'NKA'], suffix: 'i' })
    expect(splitVariableName('W_o')).toEqual({ prefix: 'W', middle: [], suffix: 'o' })
    expect(splitVariableName('Na_i')).toEqual({ prefix: null, middle: ['Na'], suffix: 'i' })
    expect(splitVariableName('area')).toEqual({ prefix: null, middle: ['area'], suffix: null })
  })
})

describe('findUnitsProperty', () => {
  it('reads each coupling property from its units dimensions, whatever their scale', () => {
    expect(findUnitsProperty('mM', UNITS)?.property).toBe('OPB:00340')
    expect(findUnitsProperty('mol_per_s', UNITS)?.property).toBe('OPB:00592')
    expect(findUnitsProperty('fmol_per_mm2_per_s', UNITS)?.property).toBe('OPB:00592')
    expect(findUnitsProperty('pA_per_mm2', UNITS)?.property).toBe('OPB:00318')
    expect(findUnitsProperty('ampere', UNITS)?.property).toBe('OPB:00318')
    expect(findUnitsProperty('mV', UNITS)?.property).toBe('OPB:00506')
    expect(findUnitsProperty('pL', UNITS)?.property).toBe('OPB:00154')
    expect(findUnitsProperty('mm2', UNITS)?.property).toBe('OPB:00295')
  })

  it('finds none for other or unknown units', () => {
    expect(findUnitsProperty('per_s', UNITS)).toBeNull()
    expect(findUnitsProperty('mole', UNITS)).toBeNull()
    expect(findUnitsProperty('nonsense', UNITS)).toBeNull()
  })
})

describe('checkPropertyUnits', () => {
  it('passes matching units, unknown units, and a current written as an amount flow', () => {
    expect(checkPropertyUnits('OPB:00340', 'mM', UNITS)).toBeNull()
    expect(checkPropertyUnits('OPB:00340', 'nonsense', UNITS)).toBeNull()
    expect(checkPropertyUnits('OPB:00318', 'fmol_per_mm2_per_s', UNITS)).toBeNull()
  })

  it('says why a property disagrees with its units', () => {
    expect(checkPropertyUnits('OPB:00340', 'mol_per_s', UNITS)).toMatch(/mol_per_s is not, which is an amount flow/)
    expect(checkPropertyUnits('OPB:00154', 'per_s', UNITS)).toMatch(/per_s is not\.$/)
  })
})

describe('guessAnnotations', () => {
  it('guesses an inward sodium flow: J_Na_in in mol/s', () => {
    const { variables } = guessRows(['J_Na_in:mol_per_s'], { sidecar: { component: { kind: 'transporter' }, variables: [] } })
    expect(variables.get('J_Na_in')).toMatchObject({
      property: 'OPB:00592',
      species: ['CHEBI:29101'],
      location: 'GO:0005737',
      confidence: 'high',
    })
    expect(variables.get('J_Na_in').why.join(' ')).toMatch(/Na is Na⁺.*Suffix _in/)
  })

  it('guesses a compartment from its concentration states and volume, and places its quantities on itself', () => {
    const analysis = analyzeMathXml(`<model xmlns="http://www.cellml.org/cellml/2.0#"><component name="cell">
      <variable name="t" units="second"/><variable name="c_K" units="mM"/><variable name="J_in" units="mol_per_s"/>
      <variable name="volume" units="pL"/><variable name="area" units="mm2"/>
      <math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>c_K</ci></apply>
      <apply><divide/><ci>J_in</ci><ci>volume</ci></apply></apply></math></component></model>`)
    const rows = analysis.declared.map(({ name, units }) => ({ name, units }))
    const kinds = new Map([['t', 'voi'], ['c_K', 'state'], ['J_in', 'external'], ['volume', 'external'], ['area', 'external']])
    const guess = guessAnnotations({ rows, kinds, analysis, unitDefinitions: UNITS })

    expect(guess.componentKind).toEqual({ kind: 'compartment', why: 'Concentration states and a volume' })
    expect(guess.variables.get('c_K')).toMatchObject({ property: 'OPB:00340', species: ['CHEBI:29103'], location: 'self' })
    expect(guess.variables.get('volume')).toMatchObject({ property: 'OPB:00154', location: 'self', confidence: 'high' })
    expect(guess.variables.get('area')).toMatchObject({ property: 'OPB:00295', location: 'self+GO:0005886' })
    expect(guess.variables.get('J_in')).toMatchObject({
      property: 'OPB:00592',
      species: ['CHEBI:29103'],
      location: 'self',
      confidence: 'high',
    })
    expect(guess.variables.get('J_in').why).toContain('Flows into d(c_K)/dt, so it is of the same species')
    expect(guess.variables.has('t')).toBe(false)
  })

  it('guesses a transporter from flows on both sides, and leaves a side-less variable needing one', () => {
    const guess = guessRows(['v_Glc_i:fmol_per_mm2_per_s', 'v_Glc_o:fmol_per_mm2_per_s', 'c_ATP:mM'])
    expect(guess.componentKind.kind).toBe('transporter')
    expect(guess.variables.get('v_Glc_o')).toMatchObject({ species: ['CHEBI:17634'], location: 'GO:0005576', confidence: 'high' })
    expect(guess.variables.get('c_ATP')).toMatchObject({ location: null, confidence: 'medium' })
    expect(guess.variables.get('c_ATP').why).toContain('Needs a side: add _i or _o, or choose one')
  })

  it('reads I_ in amount-flow units as a current on the membrane, and a membrane from its potential', () => {
    const transporter = guessRows(['I_Na:fmol_per_mm2_per_s', 'u_e:mV'], { sidecar: { component: { kind: 'transporter' }, variables: [] } })
    expect(transporter.variables.get('I_Na')).toMatchObject({ property: 'OPB:00318', species: [], location: 'GO:0005886' })
    expect(transporter.variables.get('u_e')).toMatchObject({ property: 'OPB:00506', location: 'GO:0005886', confidence: 'high' })

    const membrane = guessRows(['u:mV', 'v_tot:fmol_per_mm2_per_s'])
    expect(membrane.componentKind.kind).toBe('membrane')
    expect(membrane.variables.get('v_tot')).toMatchObject({ property: 'OPB:00318', location: 'self', confidence: 'high' })
  })

  it('takes a species token other sidecars use over the pinned table', () => {
    const workspaceSidecars = [{ variables: [{ variable: 'c_Glc', species: ['CHEBI:4167'] }] }]
    const { variables } = guessRows(['c_Glc_i:mM'], { workspaceSidecars })
    expect(variables.get('c_Glc_i').species).toEqual(['CHEBI:4167'])
    expect(variables.get('c_Glc_i').why).toContain('Glc is CHEBI:4167, as other sidecars say')
  })

  it('skips annotated variables, and keeps the sidecar’s kind', () => {
    const sidecar = { component: { kind: 'membrane' }, variables: [{ variable: 'c_Na_i', property: 'OPB:00340' }] }
    const guess = guessRows(['c_Na_i:mM', 'c_K_i:mM'], { sidecar })
    expect(guess.componentKind).toEqual({ kind: 'membrane', why: null })
    expect([...guess.variables.keys()]).toEqual(['c_K_i'])
  })

  it('holds back confidence for constants, parameters, names that disagree and unknown units', () => {
    const kinds = new Map([['c_Na_o', 'constant']])
    const sidecar = { component: { kind: 'transporter' }, variables: [] }
    const guess = guessRows(['c_Na_o:mM', 'c_Na_init_i:mM', 'K_Na_i:mM', 'v_K_i:mM', 'c_K_i:nonsense'], { kinds, sidecar })
    expect(guess.variables.get('c_Na_o').confidence).toBe('medium')
    expect(guess.variables.get('c_Na_init_i').confidence).toBe('medium')
    expect(guess.variables.get('K_Na_i').confidence).toBe('medium')
    expect(guess.variables.get('v_K_i')).toMatchObject({ property: 'OPB:00340', confidence: 'medium' })
    expect(guess.variables.get('v_K_i').why).toContain('The name reads as molar flow rate')
    expect(guess.variables.has('c_K_i')).toBe(false)
  })

  it('makes no suggestion without a species or a place', () => {
    const { variables } = guessRows(['c_X:mM', 'v_X_i:mol_per_s'])
    expect(variables.has('c_X')).toBe(false)
    expect(variables.get('v_X_i')).toMatchObject({ species: [], location: 'GO:0005737', confidence: 'medium' })
  })
})
