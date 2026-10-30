/**
 * The tables the annotation guesser reads: each coupling property's units dimensions and name prefixes, the species
 * a name token stands for, and the place a name suffix means.
 */

import { GO, OPB } from './iris.js'
import { SPECIES_ALIASES } from './species.js'

const MOLAR_FLOW_DIMENSIONS = [
  { mol: 1, s: -1 },
  { mol: 1, m: -2, s: -1 },
]
const CURRENT_DIMENSIONS = [{ A: 1 }, { A: 1, m: -2 }]

/** Each coupling property and the SI dimensions its units have, as resolveUnits writes them. */
export const PROPERTY_DIMENSIONS = [
  { property: OPB.concentration, dimensions: [{ mol: 1, m: -3 }], text: 'a concentration' },
  { property: OPB.molarFlowRate, dimensions: MOLAR_FLOW_DIMENSIONS, text: 'an amount flow' },
  { property: OPB.chargeFlowRate, dimensions: CURRENT_DIMENSIONS, text: 'a current' },
  { property: OPB.electricalPotential, dimensions: [{ kg: 1, m: 2, s: -3, A: -1 }], text: 'a potential' },
  { property: OPB.fluidVolume, dimensions: [{ m: 3 }], text: 'a volume' },
  { property: OPB.spatialArea, dimensions: [{ m: 2 }], text: 'an area' },
]

/** Dimensions a property also accepts: a charge flow is often written as the amount of charge it carries. */
export const ALSO_ACCEPTED_DIMENSIONS = new Map([
  [OPB.chargeFlowRate, MOLAR_FLOW_DIMENSIONS],
  [OPB.molarFlowRate, CURRENT_DIMENSIONS],
])

/** Whole names and the property each suggests, checked before the prefix. */
export const WHOLE_NAME_PROPERTIES = new Map([
  ['V_m', OPB.electricalPotential],
  ['Vm', OPB.electricalPotential],
  ['E_m', OPB.electricalPotential],
  ['u', OPB.electricalPotential],
  ['volume', OPB.fluidVolume],
  ['area', OPB.spatialArea],
])

/** Name prefixes, before the first underscore, and the property each suggests. */
export const NAME_PROPERTIES = new Map([
  ['c', OPB.concentration],
  ['conc', OPB.concentration],
  ['v', OPB.molarFlowRate],
  ['J', OPB.molarFlowRate],
  ['q', OPB.molarFlowRate],
  ['I', OPB.chargeFlowRate],
  ['i', OPB.chargeFlowRate],
  ['u', OPB.electricalPotential],
  ['volume', OPB.fluidVolume],
  ['vol', OPB.fluidVolume],
  ['W', OPB.fluidVolume],
  ['area', OPB.spatialArea],
])

/** Properties that are of a species, so a guess of them needs one. */
export const SPECIES_PROPERTIES = new Set([OPB.concentration, OPB.molarFlowRate])

/** Properties that are always of the membrane. */
export const MEMBRANE_PROPERTIES = new Set([OPB.electricalPotential, OPB.chargeFlowRate])

const EXTRA_SYMBOLS = {
  'CHEBI:29101': ['Na'],
  'CHEBI:29103': ['K'],
  'CHEBI:29108': ['Ca'],
  'CHEBI:17996': ['Cl'],
  'CHEBI:15378': ['H'],
  'CHEBI:17544': ['HCO3'],
  'CHEBI:18420': ['Mg'],
  'CHEBI:17634': ['Glc', 'glc'],
  'CHEBI:15422': ['ATP'],
  'CHEBI:16761': ['ADP'],
  'CHEBI:43474': ['Pi', 'P_i'],
  'CHEBI:15377': ['H2O'],
  'CHEBI:15379': ['O2'],
  'CHEBI:16526': ['CO2'],
  'CHEBI:16651': ['Lac', 'lac'],
  'CHEBI:15361': ['Pyr', 'pyr'],
  'CHEBI:28938': ['NH4'],
  'CHEBI:29985': ['Glu'],
  'CHEBI:29105': ['Zn'],
}

/**
 * Builds the species each name token stands for: symbols match by case, so 'K' is potassium but a rate 'k' is not,
 * and longer names match in any case.
 *
 * @returns {{ symbols: Map<string, string>, names: Map<string, string> }} CURIEs by symbol and by lower-case name.
 */
function buildSpeciesTokens() {
  const symbols = new Map()
  const names = new Map()
  for (const { curie, aliases } of SPECIES_ALIASES) {
    for (const symbol of EXTRA_SYMBOLS[curie] ?? []) symbols.set(symbol, curie)
    for (const alias of aliases) {
      if (alias.length > 3 && !alias.includes(' ')) names.set(alias, curie)
    }
  }
  return { symbols, names }
}

export const SPECIES_TOKENS = buildSpeciesTokens()

/** Name suffixes, after the last underscore, and the place each means. */
export const SUFFIX_LOCATIONS = new Map([
  ['i', GO.cytoplasm],
  ['in', GO.cytoplasm],
  ['cyt', GO.cytoplasm],
  ['o', GO.extracellularRegion],
  ['e', GO.extracellularRegion],
  ['ext', GO.extracellularRegion],
  ['out', GO.extracellularRegion],
  ['m', GO.plasmaMembrane],
  ['mem', GO.plasmaMembrane],
])

/** Name tokens that mark a parameter rather than a coupled quantity, e.g. c_Na_init or u_rev. */
export const PARAMETER_TOKENS = new Set(['init', 'rev', 'ref', 'max', 'min', 'half', 'raw', 'eq', '0'])

/** Words in a component's name that say what kind of module it is. */
export const COMPONENT_NAME_KINDS = [
  [/membrane/i, 'membrane'],
  [/compartment|pool|cell|cyto|lumen|blood|capillary|interstitium/i, 'compartment'],
  [/transport|channel|pump|exchanger|porter|ase$/i, 'transporter'],
]
