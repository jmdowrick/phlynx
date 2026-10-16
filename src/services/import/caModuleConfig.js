/**
 * Checks circulatory_autogen (CA) module config entries, components and super-modules, as CA's config_schemas.py does
 * (normalise_module_config_entry, normalise_supermodule_entry), with its messages; and keeps super-module templates.
 *
 * Every entry is checked, not just the first. A libcuflynx-keyed component entry (vessel_type, BC_type, module_file,
 * module_type) is read in PhLynx keys (module_type, module_subtype, component_file, component_type); the older
 * default_instance is read as default_parameterisation. Other keys (description, licence, creator,
 * required_citations, phlynx_*) are kept as they are.
 */
import { normalisePorts } from '../../utils/config'
import {
  checkParameterisationName,
  mergeRenamedKey,
  normaliseModuleRecord,
  PER_SUBMODULE_KEYS,
  pyRepr,
  pyTuple,
  pyType,
  SUPERMODULE_FORMAT,
} from './caModuleArray'

export const DEFAULT_PARAMETERISATION_KEY = 'default_parameterisation'
export const DEFAULT_INSTANCE_KEY = 'default_instance'

/** PhLynx config key -> libcuflynx config key. */
const PHLYNX_CONFIG_KEYS = {
  module_type: 'vessel_type',
  module_subtype: 'BC_type',
  component_file: 'module_file',
  component_type: 'module_type',
}
const LIBCUFLYNX_CONFIG_KEYS = Object.fromEntries(Object.entries(PHLYNX_CONFIG_KEYS).map(([p, l]) => [l, p]))
const PHLYNX_ONLY_KEYS = ['module_subtype', 'component_file', 'component_type']
const LIBCUFLYNX_ONLY_KEYS = ['vessel_type', 'BC_type', 'module_file']
const PORT_KEYS = ['entrance_ports', 'exit_ports', 'general_ports']

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Whether a config entry, in either key style, is a super-module.
 *
 * @param {*} entry
 * @returns {boolean}
 */
export function isSupermoduleEntry(entry) {
  return isObject(entry) && (entry.module_format === SUPERMODULE_FORMAT || 'submodules' in entry)
}

/** `module_type:module_subtype`. */
export const moduleRefOf = (type, subtype) => `${type}:${subtype}`

function describe(entry, source) {
  const type = entry.vessel_type ?? entry.module_type ?? '?'
  const subtype = entry.BC_type ?? entry.module_subtype ?? '?'
  return `module config entry (${type}, ${subtype})${source ? ` in ${source}` : ''}`
}

/**
 * A super-module config entry in PhLynx keys (module_type, module_subtype first), its submodules normalised as
 * module-array records (see normaliseModuleRecord) and default_instance read as default_parameterisation.
 *
 * @param {Object} entry
 * @param {string} [source] - The config file, for messages.
 * @returns {Object}
 * @throws {Error} for mixed key styles, a component key, a missing type or subtype, a module_format other than
 *   'supermodule', missing or empty submodules, a bad default_parameters or parameterisation name, repeated submodule
 *   names, or a submodule linked to anything but a sibling.
 */
export function normaliseSupermoduleEntry(entry, source) {
  const description = `supermodule ${describe(entry, source).slice('module config '.length)}`
  const hasPhlynx = ['module_type', 'module_subtype'].filter((key) => key in entry)
  const hasLibcuflynx = ['vessel_type', 'BC_type'].filter((key) => key in entry)
  if (hasPhlynx.length && hasLibcuflynx.length) {
    throw new Error(
      `${description} mixes the libcuflynx keys ${pyRepr(hasLibcuflynx)} and the PhLynx keys ${pyRepr(hasPhlynx)}. ` +
        `Use vessel_type/BC_type or module_type/module_subtype.`
    )
  }
  for (const key of ['component_file', 'component_type', 'module_file']) {
    if (key in entry) {
      throw new Error(`${description} has "${key}": a supermodule has no component of its own, only "submodules".`)
    }
  }
  const [typeKey, subtypeKey] = hasPhlynx.length ? ['module_type', 'module_subtype'] : ['vessel_type', 'BC_type']
  for (const key of [typeKey, subtypeKey]) {
    if (typeof entry[key] !== 'string' || !entry[key]) {
      throw new Error(`${description} needs a non-empty string "${key}".`)
    }
  }
  if ((entry.module_format ?? SUPERMODULE_FORMAT) !== SUPERMODULE_FORMAT) {
    throw new Error(
      `${description} has submodules but module_format "${entry.module_format}"; a supermodule entry has ` +
        `module_format "${SUPERMODULE_FORMAT}".`
    )
  }
  const submodules = entry.submodules
  if (!Array.isArray(submodules) || !submodules.length) {
    throw new Error(`${description} needs "submodules", a non-empty list of records.`)
  }
  const defaultParameters = entry.default_parameters
  if (defaultParameters !== undefined && defaultParameters !== null && typeof defaultParameters !== 'string') {
    throw new Error(
      `${description}: "default_parameters" must be a file name (string), not ${pyRepr(defaultParameters)}.`
    )
  }
  for (const key of [DEFAULT_PARAMETERISATION_KEY, DEFAULT_INSTANCE_KEY]) {
    if (key in entry) checkParameterisationName(entry[key], description, key)
  }
  const merged = mergeRenamedKey(entry, DEFAULT_PARAMETERISATION_KEY, DEFAULT_INSTANCE_KEY, description)

  const records = submodules.map((sub, index) =>
    normaliseModuleRecord(sub, { source: `${description}, submodules`, index, what: null })
  )
  const names = records.map((record) => record.name)
  const repeated = [...new Set(names.filter((name, i) => names.indexOf(name) !== i))].sort()
  if (repeated.length) throw new Error(`${description}: submodule names ${pyRepr(repeated)} are repeated.`)
  records.forEach((record, i) => {
    for (const [key, caKey] of [['inp_instances', 'inp_vessels'], ['out_instances', 'out_vessels']]) {
      const unknown = record[key].filter((name) => !names.includes(name))
      if (unknown.length) {
        throw new Error(
          `${description}, submodules[${i}] ("${record.name}"): "${caKey}" names ${pyRepr(unknown)}, which are not ` +
            `submodules of this supermodule. Submodules connect only to each other; connections to the host model ` +
            `are made by the instance's per_submodule_inputs/per_submodule_outputs.`
        )
      }
    }
    for (const key of PER_SUBMODULE_KEYS) {
      for (const [sub, hosts] of Object.entries(record[key] ?? {})) {
        const unknown = hosts.filter((host) => !names.includes(host))
        if (unknown.length) {
          throw new Error(
            `${description}, submodules[${i}] ("${record.name}"): "${key}" names ${pyRepr(unknown)} for "${sub}", ` +
              `which are not submodules of this supermodule.`
          )
        }
      }
    }
  })

  const normalised = { module_type: merged[typeKey], module_subtype: merged[subtypeKey] }
  for (const [key, value] of Object.entries(merged)) {
    if (key !== typeKey && key !== subtypeKey) normalised[key] = value
  }
  normalised.module_format = SUPERMODULE_FORMAT
  normalised.submodules = records
  if (DEFAULT_PARAMETERISATION_KEY in normalised) {
    normalised[DEFAULT_PARAMETERISATION_KEY] = normalised[DEFAULT_PARAMETERISATION_KEY].trim()
  }
  return normalised
}

/**
 * One component config entry in PhLynx keys. A PhLynx entry comes back as it is (bar default_instance); a
 * libcuflynx one has its keys renamed, module_type and module_subtype first.
 *
 * @param {Object} entry
 * @param {string} [source]
 * @returns {Object}
 * @throws {Error} for mixed key styles, missing keys, an entry in neither style, a bad parameterisation name or a
 *   multi_port CA rejects.
 */
function normaliseComponentEntry(entry, source) {
  const phlynxKeys = PHLYNX_ONLY_KEYS.filter((key) => key in entry)
  const libcuflynxKeys = LIBCUFLYNX_ONLY_KEYS.filter((key) => key in entry)
  if (phlynxKeys.length && libcuflynxKeys.length) {
    throw new Error(
      `${describe(entry, source)} mixes the libcuflynx schema (has ${pyRepr(libcuflynxKeys)}) and the PhLynx schema ` +
        `(has ${pyRepr(phlynxKeys)}). Use one schema per entry: either vessel_type/BC_type/module_file/module_type, ` +
        `or module_type/module_subtype/component_file/component_type.`
    )
  }
  let normalised
  if (phlynxKeys.length) {
    const missing = Object.keys(PHLYNX_CONFIG_KEYS).filter((key) => !(key in entry))
    if (missing.length) {
      throw new Error(
        `${describe(entry, source)} is in the PhLynx schema (has ${pyRepr(phlynxKeys)}) but is missing ` +
          `${pyRepr(missing)}. A PhLynx-schema entry needs module_type, module_subtype, component_file and ` +
          `component_type.`
      )
    }
    normalised = entry
  } else if (libcuflynxKeys.length) {
    const missing = ['vessel_type', 'BC_type', 'module_file', 'module_type'].filter((key) => !(key in entry))
    if (missing.length) {
      throw new Error(
        `${describe(entry, source)} is in the libcuflynx schema (has ${pyRepr(libcuflynxKeys)}) but is missing ` +
          `${pyRepr(missing)}. A libcuflynx-schema entry needs vessel_type, BC_type, module_file and module_type ` +
          `(the CellML component).`
      )
    }
    const renamed = Object.entries(entry).map(([key, value]) => [LIBCUFLYNX_CONFIG_KEYS[key] ?? key, value])
    const byKey = Object.fromEntries(renamed)
    normalised = { module_type: byKey.module_type, module_subtype: byKey.module_subtype }
    for (const [key, value] of renamed) if (!(key in normalised)) normalised[key] = value
  } else {
    throw new Error(
      `Cannot tell the schema of ${describe(entry, source)}: it has none of vessel_type/BC_type/module_file ` +
        `(libcuflynx) or module_subtype/component_file/component_type (PhLynx). Keys: ${pyRepr(Object.keys(entry))}`
    )
  }
  const description = describe(normalised, source)
  for (const key of [DEFAULT_PARAMETERISATION_KEY, DEFAULT_INSTANCE_KEY]) {
    if (!(key in normalised)) continue
    const name = checkParameterisationName(normalised[key], description, key)
    if (name !== normalised[key]) normalised = { ...normalised, [key]: name }
  }
  normalised = mergeRenamedKey(normalised, DEFAULT_PARAMETERISATION_KEY, DEFAULT_INSTANCE_KEY, description)
  // Rejects a multi_port circulatory_autogen would, so it isn't read as something else.
  normalisePorts(normalised, { strict: true })
  return normalised
}

/**
 * One module config entry, component or super-module, checked and in PhLynx keys.
 *
 * @param {*} entry
 * @param {string} [source]
 * @returns {Object}
 */
export function normaliseConfigEntry(entry, source) {
  if (!isObject(entry)) {
    throw new Error(
      `module config entry${source ? ` in ${source}` : ''} is a ${pyType(entry)}, not a JSON object: ${pyRepr(entry)}`
    )
  }
  return isSupermoduleEntry(entry) ? normaliseSupermoduleEntry(entry, source) : normaliseComponentEntry(entry, source)
}

/**
 * Every entry of a module config file, checked and in PhLynx keys. A super-module comes back as written, but in
 * PhLynx keys; its submodules are normalised when it is stored (see supermoduleTemplate).
 *
 * @param {*} entries - The parsed JSON.
 * @param {string} [source]
 * @returns {Object[]}
 */
export function normaliseModuleConfig(entries, source) {
  if (!Array.isArray(entries)) {
    throw new Error(`module config ${source ?? ''} must be a JSON list of entries, not a ${pyType(entries)}`)
  }
  return entries.map((entry) => {
    const normalised = normaliseConfigEntry(entry, source)
    if (!isSupermoduleEntry(entry)) return normalised
    const { submodules, ...rest } = normalised
    return { ...rest, submodules: entry.submodules }
  })
}

/**
 * A super-module as the library keeps it: CA-shaped, `{moduleRef, module_type, module_subtype, ...its other keys,
 * submodules (normalised records, in order), configFile}`.
 *
 * @param {Object} entry - A super-module config entry, either key style.
 * @param {string} [configFile] - The file it came from.
 * @returns {Object}
 */
export function supermoduleTemplate(entry, configFile) {
  const { module_type, module_subtype, ...rest } = normaliseSupermoduleEntry(entry, configFile)
  return { moduleRef: moduleRefOf(module_type, module_subtype), module_type, module_subtype, ...rest, configFile }
}

/** The moduleRefs of a template's submodules, in order. */
const submoduleRefs = (template) => template.submodules.map((sub) => moduleRefOf(sub.module_type, sub.module_subtype))

/**
 * The super-modules nested in `ref` that come back to it, as CA's cycle message lists them, or null.
 *
 * @param {string} ref
 * @param {Map<string, Object>} supermodules
 * @returns {string|null} e.g. 'loop_a/supermodule -> loop_b/supermodule -> loop_a/supermodule'.
 */
export function supermoduleCycle(ref, supermodules) {
  const walk = (current, chain) => {
    const template = supermodules.get(current)
    if (!template) return null
    if (chain.includes(current)) return [...chain, current]
    for (const child of new Set(submoduleRefs(template))) {
      const cycle = walk(child, [...chain, current])
      if (cycle) return cycle
    }
    return null
  }
  const cycle = walk(ref, [])
  return cycle && cycle.map((r) => r.replace(':', '/')).join(' -> ')
}

/**
 * Adds a super-module template to a registry, checking it as CA does when it loads module configs.
 *
 * @param {Map<string, Object>} supermodules - moduleRef -> template; changed.
 * @param {Object} template - From supermoduleTemplate.
 * @param {{has: (ref: string) => boolean}} components - The component modules.
 * @returns {boolean} Whether it was added; false for the same definition again.
 * @throws {Error} for a super-module another file defines differently, a type that is also a component, or nesting in a
 *   cycle. The registry is unchanged.
 */
export function registerSupermodule(supermodules, template, components) {
  const { moduleRef, module_type, module_subtype, configFile } = template
  const key = pyTuple(module_type, module_subtype)
  const existing = supermodules.get(moduleRef)
  if (existing && existing.configFile !== configFile) {
    const strip = ({ configFile: _file, ...rest }) => JSON.stringify(rest)
    if (strip(existing) === strip(template)) return false
    throw new Error(`supermodule ${key} is defined twice: in ${existing.configFile} and in ${configFile}.`)
  }
  if (components.has(moduleRef)) {
    throw new Error(
      `[${key}] are defined both as supermodules and as component modules in the module configs; a (vessel_type, ` +
        `BC_type) can be only one of them.`
    )
  }
  supermodules.set(moduleRef, template)
  const cycle = supermoduleCycle(moduleRef, supermodules)
  if (cycle) {
    if (existing) supermodules.set(moduleRef, existing)
    else supermodules.delete(moduleRef)
    throw new Error(`${configFile ? `${configFile}: ` : ''}supermodule ${key}: supermodules nest in a cycle (${cycle}).`)
  }
  return !existing
}

/**
 * The component moduleRefs a module array's rows use, through every super-module they instantiate, and the
 * super-modules themselves. A super-module that nests in a cycle is reported, not followed.
 *
 * @param {Array<{module_type: string, module_subtype: string}>} rows
 * @param {Map<string, Object>} [supermodules]
 * @returns {{components: Set<string>, supermodules: Set<string>, cycles: string[]}}
 */
export function resolveModuleRefs(rows, supermodules = new Map()) {
  const components = new Set()
  const used = new Set()
  const cycles = new Set()
  const visit = (ref, chain) => {
    const template = supermodules.get(ref)
    if (!template) {
      components.add(ref)
      return
    }
    if (chain.includes(ref)) {
      cycles.add([...chain, ref].map((r) => r.replace(':', '/')).join(' -> '))
      return
    }
    used.add(ref)
    submoduleRefs(template).forEach((child) => visit(child, [...chain, ref]))
  }
  rows.forEach((row) => visit(moduleRefOf(row.module_type, row.module_subtype), []))
  return { components, supermodules: used, cycles: [...cycles] }
}
