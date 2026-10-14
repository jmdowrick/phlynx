import { PORT_TYPE_OPTIONS } from './constants'
import { toRaw } from 'vue'
import { extractVariablesFromMath } from './cellml'
import { multiplyFactor, normaliseMultiport, parseMultiport, VOLUME_PORT } from './multiport'

/** The config key naming the subtype a per-instance variant of a module stands in for (see services/caVariants.js). */
export const BASE_SUBTYPE_KEY = 'phlynx_base_subtype'

// The config keys under which a variant's port keeps the instance's own fields that the variant changed.
const ORIGINAL_PORT_KEYS = {
  label: 'phlynx_label',
  portType: 'phlynx_port_type',
  variables: 'phlynx_variables',
  multiportType: 'phlynx_multi_port',
  index: 'phlynx_index',
}

export function parseMathRef(mathRef) {
  const [componentFile, componentName] = mathRef.split(':')
  return { componentFile, componentName }
}

export function parseModuleRef(moduleRef) {
  const [moduleType, moduleSubtype] = moduleRef.split(':')
  return { moduleType, moduleSubtype }
}

/**
 * Gives a module a ref no module on other math holds. MVP user modules all kept the template's
 * `new_module:phlynx`, a user copy of a library module kept the library's ref, and two files can
 * hold components of the same name.
 *
 * @param {string} moduleRef - The ref wanted.
 * @param {string} mathRef - The math the module uses.
 * @param {(ref: string) => Object|undefined} getModule - Finds a module taken so far by its ref.
 * @returns {string} The wanted ref when it is free or names the same math, else `<component>:default`,
 *   numbered `_2`, `_3`, ... until free.
 */
export function uniqueModuleRef(moduleRef, mathRef, getModule) {
  const isFree = (ref) => !getModule(ref) || getModule(ref).mathRef === mathRef
  if (isFree(moduleRef)) return moduleRef

  const base = `${parseMathRef(mathRef).componentName}:default`
  let ref = base
  for (let i = 2; !isFree(ref); i++) ref = `${base}_${i}`
  return ref
}

/**
 * A module config entry as a module. A per-instance variant the CA export wrote also gets `baseModuleRef`, the module
 * it stands in for.
 *
 * @param {Object} config
 * @returns {Object}
 */
export function normaliseConfig(config) {
  const module = {
    moduleRef: `${config.module_type}:${config.module_subtype}`,
    mathRef: `${config.component_file}:${config.component_type}`,
    ports: normalisePorts(config),
    variables: normaliseVariables(config.variables_and_units),
  }
  const base = config[BASE_SUBTYPE_KEY]
  if (typeof base === 'string' && base) module.baseModuleRef = `${config.module_type}:${base}`
  return module
}

export function buildModule(moduleRef, mathRef, math) {
  return {
    moduleRef: moduleRef,
    mathRef: mathRef,
    ports: [],
    variables: extractVariablesFromMath(math),
  }
}

/**
 * A module config's ports, as stored on a module. Leniently, for saved workspaces and the library, an
 * unknown multi_port is 'None'; strictly, for an imported config, it throws as circulatory_autogen would.
 * A Multiply port's multiply_factor becomes its multiplyFactor; a variant port's instance fields (the
 * phlynx_ keys, see services/caVariants.js) become its `original`.
 *
 * @param {Object} config - A module config entry.
 * @param {Object} [options]
 * @param {boolean} [options.strict]
 * @throws {Error} when strict and a multi_port or multiply_factor is one circulatory_autogen rejects.
 */
export function normalisePorts(config, { strict = false } = {}) {
  const ports = []
  const description = `Module "${config?.module_type}:${config?.module_subtype}"`

  PORT_TYPE_OPTIONS.forEach((portType) => {
    const list = config?.[portType.value] || []
    for (const p of list) {
      const port = {
        portType: portType.value,
        label: p.port_type, 
        variables: p.variables || [],
        multiportType: strict ? normaliseMultiport(p, description) : parseMultiport(p.multi_port),
      }
      const factor = readMultiplyFactor(p, description, strict)
      if (factor !== undefined) port.multiplyFactor = factor
      const original = readOriginalPort(p)
      if (original) port.original = original
      ports.push(port)
    }
  })
  return ports
}

// applied on export
export function restorePorts(ports) {
  const config = {}
  
  PORT_TYPE_OPTIONS.forEach((portType) => {
    config[portType.value] = []
  })

  for (const p of (ports || [])) {
    if (!config[p.portType]) {
      config[p.portType] = []
    }

    const portEntry = {
      port_type: p.label,
      variables: toRaw(p.variables) || [],
    }

    const multiPortValue = unparseMultiport(p)
    
    if (multiPortValue !== undefined) {
      portEntry.multi_port = multiPortValue
    }

    const factor = configMultiplyFactor(p)
    if (factor !== undefined) portEntry.multiply_factor = factor
    if (p.original) Object.assign(portEntry, originalPortKeys(p))

    config[p.portType].push(portEntry)
  }

  return config
}

export function normaliseVariables(RawVariablesAndUnits = []) {
  return RawVariablesAndUnits.map(([name, units, access, type]) => ({
    name,
    value: null,
    units,
    access,
    type,
    data_reference: null,
  }))
}

export function restoreVariables(variables = []) {
  return variables.map(v => [
    v.name,
    v.units,
    v.access,
    v.type
  ])
}

/**
 * The multiply_factor a config gives a whole-port Multiply on one variable, which is all CA multiplies; undefined
 * when it is 1, CA's default, or the port isn't one CA reads a factor of.
 *
 * @param {Object} port
 * @returns {number|undefined}
 * @throws {Error} when the factor is not a number.
 */
function configMultiplyFactor(port) {
  if (Array.isArray(port.multiportType) || parseMultiport(port.multiportType) !== 'Multiply') return undefined
  if ((port.variables ?? []).length !== 1) return undefined
  const factor = multiplyFactor(port, 0)
  return factor === 1 ? undefined : factor
}

/**
 * Reads a config port's multiply_factor, as circulatory_autogen does: a number, on a Multiply port only.
 *
 * @param {Object} p - A config port.
 * @param {string} description - The module, starting each message.
 * @param {boolean} strict - Whether to throw on a factor CA rejects, else leave it out.
 * @returns {number|undefined}
 */
function readMultiplyFactor(p, description, strict) {
  if (p.multiply_factor === undefined) return undefined
  const at = `${description}: port "${p.port_type}"`
  const factor = Number(p.multiply_factor)
  const isNumber = typeof p.multiply_factor === 'number' || (typeof p.multiply_factor === 'string' && p.multiply_factor.trim() !== '')
  if (!isNumber || !Number.isFinite(factor)) {
    if (strict) throw new Error(`${at} has multiply_factor ${JSON.stringify(p.multiply_factor)}, which is not a number.`)
    return undefined
  }
  if (typeof p.multi_port !== 'string' || p.multi_port.toLowerCase() !== 'multiply') {
    if (strict) throw new Error(`${at} has a multiply_factor but its multi_port is not "Multiply"; multiply_factor only applies to "Multiply" ports.`)
    return undefined
  }
  return factor
}

/**
 * Reads the instance fields a variant's config port keeps under the phlynx_ keys.
 *
 * @param {Object} p - A config port.
 * @returns {Object|null} Those fields, as a port holds them, or null when it keeps none.
 */
function readOriginalPort(p) {
  const original = {}
  if (typeof p[ORIGINAL_PORT_KEYS.label] === 'string') original.label = p[ORIGINAL_PORT_KEYS.label]
  if (PORT_TYPE_OPTIONS.some(({ value }) => value === p[ORIGINAL_PORT_KEYS.portType])) original.portType = p[ORIGINAL_PORT_KEYS.portType]
  if (Array.isArray(p[ORIGINAL_PORT_KEYS.variables])) original.variables = p[ORIGINAL_PORT_KEYS.variables]
  if (ORIGINAL_PORT_KEYS.multiportType in p) original.multiportType = parseMultiport(p[ORIGINAL_PORT_KEYS.multiportType])
  if (Number.isInteger(p[ORIGINAL_PORT_KEYS.index])) original.index = p[ORIGINAL_PORT_KEYS.index]
  return Object.keys(original).length ? original : null
}

/**
 * Writes a variant port's `original` under the phlynx_ keys.
 *
 * @param {Object} port - A port with `original`.
 * @returns {Object}
 */
function originalPortKeys({ original, label, variables }) {
  const keys = {}
  if (original.label !== undefined) keys[ORIGINAL_PORT_KEYS.label] = original.label
  if (original.portType !== undefined) keys[ORIGINAL_PORT_KEYS.portType] = original.portType
  if (original.variables !== undefined) keys[ORIGINAL_PORT_KEYS.variables] = toRaw(original.variables)
  if (original.multiportType !== undefined) {
    const written = unparseMultiport({ label: original.label ?? label, variables: original.variables ?? variables, multiportType: original.multiportType })
    keys[ORIGINAL_PORT_KEYS.multiportType] = written ?? null
  }
  if (original.index !== undefined) keys[ORIGINAL_PORT_KEYS.index] = original.index
  return keys
}

/**
 * A port's multi_port as written to a config, undefined for None. A whole-port Sum or Multiply on several
 * variables is written per variable, since circulatory_autogen reads a whole-port one as mapping one
 * variable; a volume_port keeps its whole-port Sum, CA's legacy blood-volume sum.
 */
export function unparseMultiport({ label, variables = [], multiportType }) {
  const type = Array.isArray(multiportType) ? null : parseMultiport(multiportType)
  if (type === 'None') return undefined
  const perVariable = type === 'Multiply' || (type === 'Sum' && label !== VOLUME_PORT)
  return perVariable && variables.length > 1 ? variables.map(() => type.toLowerCase()) : multiportType
}
