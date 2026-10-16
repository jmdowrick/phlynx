/**
 * Per-instance module variants in a circulatory_autogen (CA) export: `<subtype>__<hash>` configs for instances that
 * differ from their library module, and their fold-back on import.
 */
import { BASE_SUBTYPE_KEY } from '../utils/config'
import { PORT_TYPE_OPTIONS } from '../utils/constants'
import { cyrb53 } from '../utils/misc'
import { caModuleFileName } from './export/caCellml'

/** Joins a variant's subtype to the hash of its config. */
export const VARIANT_SEPARATOR = '__'
const HASH_LENGTH = 8

/**
 * A config entry's content as one string, for comparing and hashing: all but its subtypes, its variables sorted, as
 * CA reads them by name, and its component file as the export names it.
 *
 * @param {Object} entry - A module config entry.
 * @returns {string}
 */
export function configSignature(entry) {
  const { module_subtype: _subtype, [BASE_SUBTYPE_KEY]: _base, variables_and_units: variables = [], ...rest } = entry
  const componentFile = typeof rest.component_file === 'string' ? caModuleFileName(rest.component_file) : rest.component_file
  return stableStringify({ ...rest, component_file: componentFile, variables_and_units: variables.map((row) => stableStringify(row)).sort() })
}

/**
 * Names a variant's subtype from its config's signature, the same for the same config on every export.
 *
 * @param {string} baseSubtype - The subtype it stands in for.
 * @param {string} signature - From configSignature.
 * @param {number} [length] - How many characters of the hash to keep.
 * @returns {string} `<baseSubtype>__<hash>`.
 */
export function variantSubtype(baseSubtype, signature, length = HASH_LENGTH) {
  const hash = cyrb53(signature).toString(36).padStart(11, '0')
  return `${baseSubtype}${VARIANT_SEPARATOR}${hash.slice(-length)}`
}

/**
 * A variant's ports with the instance's own fields again (each port's `original`), a port moved to another type put
 * back at its place among that type's ports.
 *
 * @param {Array} ports - A variant module's ports, as normalisePorts reads them.
 * @returns {{ ports: Array, of: Map<Object, Object> }} ports: the folded ports, by type; of: each given port to its
 *   folded port.
 */
export function foldVariantPorts(ports) {
  const restored = (ports ?? []).map((port) => {
    const { original, ...rest } = port
    if (!original) return { port, folded: rest }
    const folded = { ...rest }
    for (const key of ['label', 'portType', 'variables', 'multiportType']) {
      if (original[key] !== undefined) folded[key] = original[key]
    }
    return { port, folded, moved: original.portType !== undefined, index: original.index ?? Infinity }
  })
  const types = [...PORT_TYPE_OPTIONS.map(({ value }) => value), ...new Set(restored.map(({ folded }) => folded.portType))]
  const ordered = [...new Set(types)].flatMap((type) => {
    const ofType = restored.filter(({ folded }) => folded.portType === type)
    const list = ofType.filter(({ moved }) => !moved)
    for (const entry of ofType.filter(({ moved }) => moved).sort((a, b) => a.index - b.index)) {
      list.splice(Math.min(entry.index, list.length), 0, entry)
    }
    return list
  })
  return { ports: ordered.map(({ folded }) => folded), of: new Map(restored.map(({ port, folded }) => [port, folded])) }
}

/**
 * The module a variant stands in for, as the library gets it when it doesn't hold that module yet: the variant's
 * config folded back.
 *
 * @param {Object} module - A variant module (see normaliseConfig's baseModuleRef).
 * @returns {Object}
 */
export function foldVariantModule(module) {
  const { baseModuleRef, ...rest } = module
  return { ...rest, moduleRef: baseModuleRef, ports: foldVariantPorts(module.ports).ports }
}

/**
 * Folds the instances an import built from variants back onto the modules they stand in for: each takes the base
 * module's ref and its ports' own fields, keeping the variables and math the variant gave it, and the couplings
 * resolved through the variant's ports move onto the folded ports, with their slots.
 *
 * @param {Array} nodes - The instances built; changed in place.
 * @param {Array} edges - Their edges; changed in place.
 * @param {Array<Object|undefined>} modules - The module each instance was built from, in the same order.
 */
export function foldVariantNodes(nodes, edges, modules) {
  const folds = new Map()
  nodes.forEach((node, index) => {
    const module = modules[index]
    if (!module?.baseModuleRef) return
    const { ports, of } = foldVariantPorts(node.data.ports)
    node.data = { ...node.data, moduleRef: module.baseModuleRef, ports }
    folds.set(node.id, { ports, of })
  })
  if (!folds.size) return

  const slotIn = (ports, port) => ports.filter((p) => p.portType === port.portType && p.label === port.label).indexOf(port)
  for (const edge of edges) {
    const [source, target] = [folds.get(edge.source), folds.get(edge.target)]
    if (!source && !target) continue
    const couplings = (edge.data?.couplings ?? []).map((coupling) => {
      const next = { ...coupling }
      if (source?.of.has(coupling.sourcePort)) {
        next.sourcePort = source.of.get(coupling.sourcePort)
        next.sourceSlot = slotIn(source.ports, next.sourcePort)
      }
      if (target?.of.has(coupling.targetPort)) {
        next.targetPort = target.of.get(coupling.targetPort)
        next.targetSlot = slotIn(target.ports, next.targetPort)
      }
      return next
    })
    edge.data = { ...edge.data, couplings }
  }
}

/**
 * JSON with each object's keys sorted, so equal content gives an equal string.
 *
 * @param {*} value
 * @returns {string}
 */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}
