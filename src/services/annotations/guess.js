/**
 * Guesses a module's annotations from its variables' units, names and equations: pure and local, with no lookups.
 */

import { GO, OPB } from './iris.js'
import { displayLabel } from './labels.js'
import { classifyAnnotationRow, isAnnotatedEntry } from './draft.js'
import {
  ALSO_ACCEPTED_DIMENSIONS,
  COMPONENT_NAME_KINDS,
  MEMBRANE_PROPERTIES,
  NAME_PROPERTIES,
  PARAMETER_TOKENS,
  PROPERTY_DIMENSIONS,
  SPECIES_PROPERTIES,
  SPECIES_TOKENS,
  SUFFIX_LOCATIONS,
  WHOLE_NAME_PROPERTIES,
} from './guessTables.js'
import { resolveUnits, sameDimensions } from '../../utils/units.js'

const KIND_TEXT = { compartment: 'a compartment', membrane: 'a membrane', transporter: 'a transporter' }

/**
 * Splits a variable name at its underscores.
 *
 * @param {string} name
 * @returns {{ prefix: string|null, middle: string[], suffix: string|null }} The prefix when it names a property, the
 *   suffix when it names a place, and the tokens between.
 */
export function splitVariableName(name) {
  const parts = String(name).split('_').filter(Boolean)
  const prefix = parts.length > 1 && NAME_PROPERTIES.has(parts[0]) ? parts[0] : null
  const rest = prefix ? parts.slice(1) : parts
  const last = rest[rest.length - 1]
  const suffix = rest.length > (prefix ? 0 : 1) && SUFFIX_LOCATIONS.has(last) ? last : null
  return { prefix, middle: suffix ? rest.slice(0, -1) : rest, suffix }
}

/**
 * Splits a name token at case changes and digits, e.g. 'NaK' into 'Na' and 'K'.
 *
 * @param {string} token
 * @returns {string[]}
 */
function splitToken(token) {
  return token.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g) ?? []
}

/**
 * Finds the species one name token stands for.
 *
 * @param {string} token
 * @param {Map<string, string>} learned - CURIEs by token, from the workspace's sidecars; these win.
 * @returns {string|null}
 */
function findTokenSpecies(token, learned) {
  return learned.get(token) ?? SPECIES_TOKENS.symbols.get(token) ?? SPECIES_TOKENS.names.get(token.toLowerCase()) ?? null
}

/**
 * Finds the species a variable's name mentions.
 *
 * @param {string[]} tokens - The name's middle tokens, from splitVariableName.
 * @param {Map<string, string>} learned
 * @returns {Array<{ curie: string, token: string, isLearned: boolean }>}
 */
function findNameSpecies(tokens, learned) {
  const found = new Map()
  for (const token of tokens) {
    const whole = findTokenSpecies(token, learned)
    const matches = whole ? [[token, whole]] : splitToken(token).map((part) => [part, findTokenSpecies(part, learned)])
    for (const [part, curie] of matches) {
      if (curie && !found.has(curie)) found.set(curie, { curie, token: part, isLearned: learned.has(part) })
    }
  }
  return [...found.values()]
}

/**
 * Learns the species each name token stands for from annotated sidecars: a variable with one middle token and one
 * species teaches that token.
 *
 * @param {Array<Object|null>} sidecars - From parseSidecar.
 * @returns {Map<string, string>}
 */
export function learnSpeciesTokens(sidecars) {
  const learned = new Map()
  for (const sidecar of sidecars) {
    for (const entry of sidecar?.variables ?? []) {
      const { middle } = splitVariableName(entry.variable)
      if (middle.length === 1 && entry.species?.length === 1 && !learned.has(middle[0])) learned.set(middle[0], entry.species[0])
    }
  }
  return learned
}

/**
 * Finds the coupling property a units name's dimensions say.
 *
 * @param {string} units
 * @param {Map<string, Array<Object>>} definitions - From mergeUnitDefinitions.
 * @param {Map<string, Object|null>} [cache] - Shared across calls to resolveUnits.
 * @returns {{ property: string, text: string }|null} Null when the units are unknown or say no coupling property.
 */
export function findUnitsProperty(units, definitions, cache = new Map()) {
  const expansion = units ? resolveUnits(units, definitions, cache) : null
  if (!expansion) return null
  for (const { property, dimensions, text } of PROPERTY_DIMENSIONS) {
    if (dimensions.some((wanted) => sameDimensions(expansion, { dimensions: wanted }))) return { property, text }
  }
  return null
}

/**
 * Checks a property against its variable's units.
 *
 * @param {string|null} property - An OPB CURIE.
 * @param {string} units
 * @param {Map<string, Array<Object>>} definitions
 * @param {Map<string, Object|null>} [cache]
 * @returns {string|null} Why they disagree, or null when they agree or the units are unknown.
 */
export function checkPropertyUnits(property, units, definitions, cache = new Map()) {
  const entry = PROPERTY_DIMENSIONS.find((candidate) => candidate.property === property)
  const expansion = entry && units ? resolveUnits(units, definitions, cache) : null
  if (!expansion) return null
  const accepted = [...entry.dimensions, ...(ALSO_ACCEPTED_DIMENSIONS.get(property) ?? [])]
  if (accepted.some((wanted) => sameDimensions(expansion, { dimensions: wanted }))) return null
  const found = findUnitsProperty(units, definitions, cache)
  const foundText = found ? `, which is ${found.text}` : ''
  return `${displayLabel(property)} is ${entry.text}, but ${units} is not${foundText}.`
}

/**
 * Finds the property a variable's name suggests.
 *
 * @param {string} name
 * @param {string|null} prefix - From splitVariableName.
 * @returns {string|null}
 */
function findNameProperty(name, prefix) {
  return WHOLE_NAME_PROPERTIES.get(name) ?? (prefix ? NAME_PROPERTIES.get(prefix) : null) ?? null
}

/**
 * Whether two properties are the same, counting amount and charge flows as one: a current is often written as an
 * amount flow.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function isSameFamily(a, b) {
  const isFlow = (property) => property === OPB.molarFlowRate || property === OPB.chargeFlowRate
  return a === b || (isFlow(a) && isFlow(b))
}

/**
 * Finds each state's flows: the variables its d(x)/dt uses, when that equation has only the one state.
 *
 * @param {Object|null} analysis - From analyzeMathXml.
 * @returns {Map<string, string>} The state by flow name.
 */
function findStateFlows(analysis) {
  const states = new Set(analysis?.stateVariables ?? [])
  const voi = new Set(analysis?.voi ?? [])
  const stateOf = new Map()
  for (const { target, uses } of analysis?.dependencies ?? []) {
    if (target) continue
    const used = uses.filter((name) => !voi.has(name))
    const equationStates = used.filter((name) => states.has(name))
    if (equationStates.length !== 1) continue
    for (const name of used) if (name !== equationStates[0] && !stateOf.has(name)) stateOf.set(name, equationStates[0])
  }
  return stateOf
}

/**
 * Guesses the module's kind from its variables' properties and names.
 *
 * @param {Array<{ name: string, property: string|null, suffix: string|null, isState: boolean, hasSpecies: boolean }>} facts
 * @param {string} componentName
 * @returns {{ kind: string|null, why: string|null }}
 */
function guessComponentKind(facts, componentName) {
  const has = (test) => facts.some(test)
  const isFlow = (fact) => fact.property === OPB.molarFlowRate || fact.property === OPB.chargeFlowRate
  const hasStates = has((fact) => fact.isState)
  const hasFlowIn = (location) => has((fact) => isFlow(fact) && SUFFIX_LOCATIONS.get(fact.suffix) === location)
  const hasSidedFlows = hasFlowIn(GO.cytoplasm) && hasFlowIn(GO.extracellularRegion)
  if (hasSidedFlows && !hasStates) return { kind: 'transporter', why: 'Flows on both sides (_i and _o) and no states' }
  const hasConcentrationState = has((fact) => fact.isState && fact.property === OPB.concentration)
  if (hasConcentrationState && has((fact) => fact.property === OPB.fluidVolume)) {
    return { kind: 'compartment', why: 'Concentration states and a volume' }
  }
  const hasPotential = has((fact) => fact.property === OPB.electricalPotential)
  const hasChargeFlow = has((fact) => fact.property === OPB.chargeFlowRate || (isFlow(fact) && !fact.hasSpecies))
  if (hasPotential && hasChargeFlow && !has((fact) => fact.property === OPB.concentration)) {
    return { kind: 'membrane', why: 'A potential and charge flows' }
  }
  const named = COMPONENT_NAME_KINDS.find(([pattern]) => pattern.test(componentName ?? ''))
  if (named) return { kind: named[1], why: `Its name, ${componentName}, reads as ${KIND_TEXT[named[1]]}` }
  return { kind: null, why: null }
}

/**
 * Guesses where a quantity is, relative to the instance.
 *
 * @param {string} property
 * @param {string|null} suffix
 * @param {string|null} componentKind
 * @returns {{ location: string|null, why: string }}
 */
function guessLocation(property, suffix, componentKind) {
  if (MEMBRANE_PROPERTIES.has(property)) {
    if (componentKind === 'membrane') return { location: 'self', why: 'A membrane’s own potential or current' }
    if (componentKind === 'compartment') return { location: `self+${GO.plasmaMembrane}`, why: 'On the compartment’s membrane' }
    return { location: GO.plasmaMembrane, why: 'Potentials and currents are across the plasma membrane' }
  }
  if (property === OPB.spatialArea) {
    if (componentKind === 'compartment') return { location: `self+${GO.plasmaMembrane}`, why: 'A compartment’s area is its membrane’s' }
    if (componentKind === 'membrane') return { location: 'self', why: 'A membrane’s own area' }
    return { location: GO.plasmaMembrane, why: 'An area is of the plasma membrane' }
  }
  if (suffix) {
    const location = SUFFIX_LOCATIONS.get(suffix)
    return { location, why: `Suffix _${suffix} reads as the ${displayLabel(location)}` }
  }
  if (componentKind === 'compartment' || componentKind === 'membrane') {
    return { location: 'self', why: `No side suffix, so it is of ${KIND_TEXT[componentKind]} itself` }
  }
  if (componentKind === 'transporter') return { location: null, why: 'Needs a side: add _i or _o, or choose one' }
  return { location: null, why: 'Choose the module’s kind to place it' }
}

/**
 * Guesses the annotations of a module's variables that its sidecar doesn't annotate yet.
 *
 * @param {Object} input
 * @param {Array<{ name: string, units?: string, type?: string }>} input.rows - Parameter rows.
 * @param {Map<string, string>|null} [input.kinds] - Each variable's kind, from classifyRows.
 * @param {Object|null} [input.analysis] - From analyzeMathXml, for the flows into each state.
 * @param {string} [input.componentName]
 * @param {Map<string, Array<Object>>} [input.unitDefinitions] - From mergeUnitDefinitions.
 * @param {Object|null} [input.sidecar] - The math's parsed sidecar: its kind is kept and its variables are skipped.
 * @param {Array<Object|null>} [input.workspaceSidecars] - Other parsed sidecars, whose species terms win.
 * @returns {{ componentKind: { kind: string|null, why: string|null },
 *   variables: Map<string, { property: string, species: string[], location: string|null,
 *   confidence: 'high'|'medium', why: string[] }> }}
 */
export function guessAnnotations({
  rows = [],
  kinds = null,
  analysis = null,
  componentName = '',
  unitDefinitions = new Map(),
  sidecar = null,
  workspaceSidecars = [],
} = {}) {
  const cache = new Map()
  const learned = learnSpeciesTokens([sidecar, ...workspaceSidecars])
  const annotated = new Set((sidecar?.variables ?? []).filter(isAnnotatedEntry).map((entry) => entry.variable))

  const facts = rows
    .map((row) => ({ row, role: classifyAnnotationRow(row, kinds) }))
    .filter(({ role }) => role !== 'voi')
    .map(({ row, role }) => {
      const { prefix, middle, suffix } = splitVariableName(row.name)
      const unitsProperty = findUnitsProperty(row.units, unitDefinitions, cache)
      const species = findNameSpecies(middle, learned)
      return {
        name: row.name,
        units: row.units,
        role,
        prefix,
        middle,
        suffix,
        species,
        hasSpecies: species.length > 0,
        isState: kinds?.get(row.name) === 'state',
        unitsProperty,
        nameProperty: findNameProperty(row.name, prefix),
        property: unitsProperty?.property ?? null,
      }
    })

  for (const fact of facts) {
    if (fact.property === OPB.molarFlowRate && fact.nameProperty === OPB.chargeFlowRate) {
      fact.property = OPB.chargeFlowRate
      fact.chargeReason = 'the name reads as a current carried as an amount'
    }
  }

  const sidecarKind = sidecar?.component?.kind ?? null
  const componentKind = sidecarKind ? { kind: sidecarKind, why: null } : guessComponentKind(facts, componentName)
  const kind = componentKind.kind

  if (kind === 'membrane') {
    for (const fact of facts) {
      if (fact.property !== OPB.molarFlowRate || fact.hasSpecies) continue
      fact.property = OPB.chargeFlowRate
      fact.chargeReason = 'a membrane’s flow of no species is its current'
    }
  }

  const guesses = new Map()
  for (const fact of facts) {
    if (!fact.property) continue
    const why = [`${fact.units} is ${PROPERTY_DIMENSIONS.find((entry) => entry.property === fact.property).text}`]
    if (fact.chargeReason) why[0] = `${fact.units} is ${fact.unitsProperty.text}, and ${fact.chargeReason}`
    const needsSpecies = SPECIES_PROPERTIES.has(fact.property)
    const species = needsSpecies ? fact.species.map((found) => found.curie) : []
    for (const found of needsSpecies ? fact.species : []) {
      why.push(`${found.token} is ${displayLabel(found.curie)}${found.isLearned ? ', as other sidecars say' : ''}`)
    }
    const place = guessLocation(fact.property, fact.suffix, kind)
    why.push(place.why)
    guesses.set(fact.name, {
      fact,
      property: fact.property,
      species,
      location: place.location,
      why,
    })
  }

  for (const [flow, state] of findStateFlows(analysis)) {
    const guess = guesses.get(flow)
    const stateGuess = guesses.get(state)
    const stateEntry = sidecar?.variables?.find((entry) => entry.variable === state)
    const source = isAnnotatedEntry(stateEntry) ? stateEntry : stateGuess
    if (!guess || !source || guess.property !== OPB.molarFlowRate) continue
    if (!guess.species.length && source.species?.length) {
      guess.species = [...source.species]
      guess.why.push(`Flows into d(${state})/dt, so it is of the same species`)
    }
    if (source.location && guess.location !== source.location) {
      guess.location = source.location
      guess.why.push(`Flows into d(${state})/dt, so it is in the same place`)
    }
  }

  const variables = new Map()
  for (const [name, { fact, property, species, location, why }] of guesses) {
    if (annotated.has(name)) continue
    const hasSpeciesSlot = !SPECIES_PROPERTIES.has(property) || species.length > 0
    const isNameAgreeing = !!fact.nameProperty && isSameFamily(fact.nameProperty, property)
    if (fact.nameProperty && !isNameAgreeing) why.push(`The name reads as ${displayLabel(fact.nameProperty)}`)
    const parameterToken = fact.middle.find((token) => PARAMETER_TOKENS.has(token))
    if (parameterToken) why.push(`_${parameterToken} reads as a parameter`)
    if (fact.role === 'constant') why.push('A constant, so it is rarely coupled')
    const isHigh = isNameAgreeing && hasSpeciesSlot && !!location && fact.role !== 'constant' && !parameterToken
    const isMedium = (SPECIES_PROPERTIES.has(property) && species.length > 0) || !!location
    if (!isHigh && !isMedium) continue
    variables.set(name, { property, species, location, confidence: isHigh ? 'high' : 'medium', why })
  }
  return { componentKind, variables }
}
