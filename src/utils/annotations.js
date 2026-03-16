import { BQBIOL_NS, CELLML_NS } from './constants.js'
import { CHEBI_NAMES, FMA_NAMES, OPB_NAMES } from './annotationLuts.js'
import { buildVariableIdMap, extractVariablesFromModule } from './cellml.js'

export function buildConfigFromAnnotations(annotations, modelBasePrefix, cellmlString) {
  const variableIdMap = buildVariableIdMap(cellmlString)
  const descriptors = extractPortDescriptors(annotations, modelBasePrefix, variableIdMap)
  if (descriptors.length === 0) {
    console.warn(`No port descriptors found in ${filename}.`)
    return null
  }
  const componentName = inferComponentName(cellmlString, descriptors.map((d) => d.variableId))
  if (!componentName) {
    console.warn(`Could not match annotations to a component in "${cellmlFilename}".`)
  }

  const portLabels = portLabelsFromDescriptors(descriptors)

  const vars = extractVariablesFromModule(cellmlString, componentName)

  const config = {
    vessel_type: componentName,
    BC_type: '__annotated__',
    module_format: 'cellml',
    module_file: cellmlFilenameFromPrefix(modelBasePrefix),
    module_type: componentName,
    entrance_ports: [],
    exit_ports: [],
    general_ports: portLabels,
    variables_and_units: vars.map((v) => [v.name, v.units, 'access', 'variable']),
  }
  return config
}
 
/**
 * Identifies the CellML component whose variable ids overlap with the annotated
 * variable ids. 
 */
export function inferComponentName(cellmlString, annotatedVariableIds) {
  const doc = new DOMParser().parseFromString(cellmlString, 'application/xml')
  const annotatedSet = new Set(annotatedVariableIds)

  for (const component of doc.getElementsByTagNameNS(CELLML_NS, 'component')) {
    const hasMatch = Array.from(
      component.getElementsByTagNameNS(CELLML_NS, 'variable')
    ).some((v) => annotatedSet.has(v.getAttribute('id')))
    if (hasMatch) return component.getAttribute('name')
  }
  return null
}
 
/**
 * Produces a human-readable port label string from a coupling key.
 */
export function labelForCouplingKey(key) {
  const [chebi, fma, opb] = key.split('|')
  const species     = CHEBI_NAMES[chebi] || chebi
  const compartment = FMA_NAMES[fma]     || fma
  const property    = OPB_NAMES[opb]     || opb
 
  return `${species} [${compartment}] ${property}`
}
 
/**
 * Converts extracted port descriptors into port label objects compatible with
 * the existing EditModuleDialog / port label infrastructure.
 *
 * opb:00425 (molar quantity) uses multiport 'Sum' — these are flow contributions
 * to a shared pool, which maps directly to the existing Sum multiport behaviour.
 * opb:00378 (chemical potential) uses 'None' — it is a shared state variable,
 * connected directly rather than summed.
 */
export function portLabelsFromDescriptors(descriptors) {
  return descriptors
    .filter((d) => d.variableName && d.couplingKey)
    .map((d) => ({
      port_type: labelForCouplingKey(d.couplingKey),
      variables: [d.variableName],
      // multi_port:      d.opbProperty === 'opb:00425' ? 'Sum' : 'None',
    }))
}

/**
 * Scans quads for the prefix IRI ending in '.cellml#', which identifies
 * the CellML file this annotation file belongs to.
 * Returns e.g. "./SGLT1_BG_annotated.cellml#", or null if not found.
 */
export function inferModelBasePrefix(quads) {
  for (const q of quads) {
    const match = q.subject.value.match(/^(.+\.cellml#)/)
    if (match) return match[1]
  }
  return null
}

/**
 * Derives the bare CellML filename from a model base prefix IRI.
 * e.g. "./SGLT1_BG_annotated.cellml#" -> "SGLT1_BG_annotated.cellml"
 */
export function cellmlFilenameFromPrefix(modelBasePrefix) {
  return modelBasePrefix
    .replace(/^.*\//, '') // strip leading path
    .replace(/#$/, '')    // strip trailing #
}

/**
 * Produces a canonical coupling key for a port descriptor.
 * Two ports with the same key represent the same physical quantity
 * in the same compartment and should be coupled.
 *
 * Returns null if any required field is missing.
 */
export function portCouplingKey({ chebiId, compartmentId, opbProperty }) {
  if (!chebiId || !compartmentId || !opbProperty) return null
  return `${chebiId}|${compartmentId}|${opbProperty}`
}

/**
 * Extracts port descriptors from a parsed quad array, cross-referencing
 * a CellML variable id→name map to resolve human-readable variable names.
 *
 * Only variables with a model_base: subject (actual CellML variable element ids)
 * are included. Activity-level OPB properties (opb:00592) live on local: subjects
 * and are excluded naturally by the model_base prefix filter.
 *
 * Each descriptor:
 * {
 *   variableId:    string,        // CellML element id, e.g. "b4dab3"
 *   variableName:  string | null, // CellML variable name, e.g. "q_Glci"
 *   participantId: string,        // local entity name, e.g. "glucose_in"
 *   chebiId:       string | null, // e.g. "chebi:4167"
 *   compartmentId: string | null, // FMA id, e.g. "fma:66836"
 *   opbProperty:   string,        // "opb:00378" (potential) | "opb:00425" (quantity)
 *   multiplier:    number,
 *   couplingKey:   string | null,
 * }
 */
export function extractPortDescriptors(quads, modelBasePrefix, variableIdMap = new Map()) {
  const bySubject = new Map()
  for (const q of quads) {
    const s = q.subject.value
    if (!bySubject.has(s)) bySubject.set(s, [])
    bySubject.get(s).push(q)
  }

  // 1. CellML variable id -> participantIRI and OPB property type
  const varToParticipant = new Map()
  const varToOpb = new Map()

  for (const [subject, triples] of bySubject) {
    if (!subject.startsWith(modelBasePrefix)) continue
    const cellmlId = subject.slice(modelBasePrefix.length)

    for (const t of triples) {
      const pred = t.predicate.value
      if (pred === `${BQBIOL_NS}isPropertyOf`) {
        varToParticipant.set(cellmlId, t.object.value)
      }
      if (pred === `${BQBIOL_NS}isVersionOf`) {
        varToOpb.set(cellmlId, t.object.value.replace('http://identifiers.org/', ''))
      }
    }
  }

  // 2. participantIRI -> { chebiId, compartmentEntity, multiplier }
  const participantInfo = new Map()
  for (const [subject, triples] of bySubject) {
    const info = {}
    for (const t of triples) {
      const pred = t.predicate.value
      const obj  = t.object.value
      if (pred === `${BQBIOL_NS}is` && obj.includes('CHEBI:')) {
        info.chebiId = obj.replace(/.*CHEBI:/, 'chebi:')
      }
      if (pred === `${BQBIOL_NS}isPartOf`) {
        info.compartmentEntity = obj
      }
      if (pred === `${BQBIOL_NS}hasMultiplier`) {
        info.multiplier = parseFloat(obj)
      }
    }
    if (Object.keys(info).length) participantInfo.set(subject, info)
  }

  // 3. compartmentIRI -> FMA short id
  const compartmentFma = new Map()
  for (const [subject, triples] of bySubject) {
    for (const t of triples) {
      if (t.predicate.value === `${BQBIOL_NS}is` && t.object.value.includes('identifiers.org/FMA:')) {
        compartmentFma.set(subject, t.object.value.replace(/.*FMA:/, 'fma:'))
      }
    }
  }

  // 4. Assemble port descriptors
  const ports = []
  for (const [cellmlId, participantIRI] of varToParticipant) {
    const opbProperty = varToOpb.get(cellmlId)
    if (!opbProperty) continue

    const info    = participantInfo.get(participantIRI) || {}
    const compIRI = info.compartmentEntity
    const fmaId   = compIRI ? (compartmentFma.get(compIRI) || null) : null
    const localId = participantIRI.split('#').pop()

    const descriptor = {
      variableId:    cellmlId,
      variableName:  variableIdMap.get(cellmlId) || null,
      participantId: localId,
      chebiId:       info.chebiId ?? null,
      compartmentId: fmaId,
      opbProperty,
      multiplier:    info.multiplier ?? 1.0,
      couplingKey:   null,
    }
    descriptor.couplingKey = portCouplingKey(descriptor)
    ports.push(descriptor)
  }

  return ports
}