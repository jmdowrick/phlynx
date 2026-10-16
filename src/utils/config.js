import { PORT_TYPE_OPTIONS } from './constants'
import { toRaw } from 'vue'
import { extractVariablesFromMath } from './cellml'
import { normaliseMultiport, parseMultiport, VOLUME_PORT } from './multiport'

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

export function normaliseConfig(config) {
  return {
    moduleRef: `${config.module_type}:${config.module_subtype}`,
    mathRef: `${config.component_file}:${config.component_type}`,
    ports: normalisePorts(config),
    variables: normaliseVariables(config.variables_and_units),
  }
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
 *
 * @param {Object} config - A module config entry.
 * @param {Object} [options]
 * @param {boolean} [options.strict]
 * @throws {Error} when strict and a multi_port is one circulatory_autogen rejects.
 */
export function normalisePorts(config, { strict = false } = {}) {
  const ports = []
  const description = `Module "${config?.module_type}:${config?.module_subtype}"`

  PORT_TYPE_OPTIONS.forEach((portType) => {
    const list = config?.[portType.value] || []
    for (const p of list) {
      ports.push({
        portType: portType.value,
        label: p.port_type, 
        variables: p.variables || [],
        multiportType: strict ? normaliseMultiport(p, description) : parseMultiport(p.multi_port),
      })
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
 * A port's multi_port as written to a config, undefined for None. A whole-port Sum or Multiply on several
 * variables is written per variable, since circulatory_autogen reads a whole-port one as mapping one
 * variable; a volume_port keeps its whole-port Sum, CA's legacy blood-volume sum.
 */
function unparseMultiport({ label, variables = [], multiportType }) {
  const type = Array.isArray(multiportType) ? null : parseMultiport(multiportType)
  if (type === 'None') return undefined
  const perVariable = type === 'Multiply' || (type === 'Sum' && label !== VOLUME_PORT)
  return perVariable && variables.length > 1 ? variables.map(() => type.toLowerCase()) : multiportType
}
