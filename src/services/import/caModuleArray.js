/**
 * Reads circulatory_autogen (CA) module arrays: `<prefix>_module_array.json`, a list of records, and the legacy CSV.
 * A port of CA's config_schemas.py (normalise_vessel_record, module_array_csv_to_records), pinned in
 * services/import/ca-schemas/README.md, with its error messages.
 *
 * Records come in PhLynx keys (name, module_type, module_subtype, inp_instances, out_instances) or libcuflynx keys
 * (name, vessel_type, BC_type, inp_vessels, out_vessels), never mixed. Both read as one shape, the PhLynx keys first:
 * `{name, module_type, module_subtype, inp_instances: string[], out_instances: string[], ...others}`, with
 * per_submodule_inputs/outputs as `{submodule: [hosts]}` in their order, and every other key kept as it was.
 */

export const SUPERMODULE_FORMAT = 'supermodule'
export const PER_SUBMODULE_KEYS = ['per_submodule_inputs', 'per_submodule_outputs']
export const PARAMETERISATION_KEY = 'parameterisation'
export const INSTANCE_KEY = 'instance'

/** PhLynx record key -> libcuflynx record key. */
export const PHLYNX_ARRAY_KEYS = {
  module_type: 'vessel_type',
  module_subtype: 'BC_type',
  inp_instances: 'inp_vessels',
  out_instances: 'out_vessels',
}
const LIBCUFLYNX_ARRAY_KEYS = Object.fromEntries(Object.entries(PHLYNX_ARRAY_KEYS).map(([phlynx, ca]) => [ca, phlynx]))
const LIBCUFLYNX_ONLY_KEYS = ['BC_type', 'vessel_type', 'inp_vessels', 'out_vessels']
const RECORD_KEYS = ['name', 'module_type', 'module_subtype', 'inp_instances', 'out_instances']
const LIST_KEYS = ['inp_instances', 'out_instances']

/** The columns a CSV module array has, in each layout. */
export const MODULE_ARRAY_COLUMNS = {
  phlynx: ['name', 'module_type', 'module_subtype', 'inp_instances', 'out_instances'],
  libcuflynx: ['name', 'BC_type', 'vessel_type', 'inp_vessels', 'out_vessels'],
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * A value as Python's repr writes it, so messages read as CA's do.
 *
 * @param {*} value
 * @returns {string}
 */
export function pyRepr(value) {
  if (value === null || value === undefined) return 'None'
  if (value === true) return 'True'
  if (value === false) return 'False'
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(', ')}]`
  if (isObject(value)) return `{${Object.entries(value).map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`).join(', ')}}`
  return String(value)
}

/**
 * The Python type name of a JSON value, for "is a str, not a JSON object" messages.
 *
 * @param {*} value
 * @returns {string}
 */
export function pyType(value) {
  if (value === null || value === undefined) return 'NoneType'
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'string') return 'str'
  if (typeof value === 'boolean') return 'bool'
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float'
  return 'dict'
}

/** A Python tuple of strings, `('heart', 'Argus2026_v01')`. */
export const pyTuple = (...items) => `(${items.map(pyRepr).join(', ')})`

/**
 * Checks a parameterisation name, which is a directory name under parameterisations/.
 *
 * @param {*} value
 * @param {string} where
 * @param {string} [key]
 * @returns {string} The name, trimmed.
 * @throws {Error} for a non-string, empty or path-like name.
 */
export function checkParameterisationName(value, where, key = PARAMETERISATION_KEY) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${where}: "${key}" must be a non-empty string (a parameterisation name), not ${pyRepr(value)}.`)
  }
  const name = value.trim()
  if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error(
      `${where}: "${key}" is "${name}", but a parameterisation name is a directory name under parameterisations/, ` +
        `not a path.`
    )
  }
  return name
}

/**
 * A copy of `mapping` with its older key stored under the new one. Both with different values is an error.
 *
 * @param {Object} mapping
 * @param {string} newKey - e.g. 'default_parameterisation'.
 * @param {string} oldKey - e.g. 'default_instance'.
 * @param {string} where
 * @returns {Object}
 */
export function mergeRenamedKey(mapping, newKey, oldKey, where) {
  if (!(oldKey in mapping)) return mapping
  if (newKey in mapping) {
    const [current, old] = [mapping[newKey], mapping[oldKey]]
    const same =
      (typeof current === 'string' && typeof old === 'string' && current.trim() === old.trim()) || current === old
    if (!same) {
      throw new Error(
        `${where} has both "${newKey}" (${pyRepr(current)}) and its older name "${oldKey}" (${pyRepr(old)}). ` +
          `Give only "${newKey}".`
      )
    }
  }
  return Object.fromEntries(
    Object.entries(mapping)
      .filter(([key]) => key !== newKey)
      .map(([key, value]) => [key === oldKey ? newKey : key, value])
  )
}

/**
 * Hook for path-addressed references (`heart/ra`, `soma/membrane`) in inp/out lists and per_submodule_* keys. Their
 * syntax is still being agreed with circulatory_autogen (CA#582), so none is read yet: a name with `/` is refused here,
 * the one place such a reference would be parsed.
 *
 * @param {string} name - A name containing '/'.
 * @param {string} where
 * @param {string} key
 * @throws {Error} always, until CA#582 is settled.
 */
export function parsePathReference(name, where, key) {
  throw new Error(
    `${where}: "${key}" names "${name}", a path reference. Path references are not supported until ` +
      `circulatory_autogen settles their syntax (CA#582); name the instance itself and link its submodules through ` +
      `per_submodule_inputs/per_submodule_outputs.`
  )
}

/**
 * Names from a list of strings or one space-separated string; null is none.
 *
 * @param {*} value
 * @param {string} where
 * @param {string} key
 * @returns {string[]}
 */
function nameList(value, where, key) {
  if (value === null || value === undefined) return []
  let names
  if (typeof value === 'string') {
    names = value.split(/\s+/).filter(Boolean)
  } else if (Array.isArray(value)) {
    names = []
    for (const item of value) {
      if (typeof item !== 'string') {
        throw new Error(`${where}: "${key}" must be a list of names (strings), but contains ${pyRepr(item)}.`)
      }
      names.push(...item.split(/\s+/).filter(Boolean))
    }
  } else {
    throw new Error(`${where}: "${key}" must be a list of names or a space-separated string, not ${pyRepr(value)}.`)
  }
  for (const name of names) if (name.includes('/')) parsePathReference(name, where, key)
  return names
}

/**
 * per_submodule_inputs/outputs as an ordered `{submodule: [hosts]}`, from an object or a list of one-key objects.
 *
 * @param {*} value
 * @param {string} where
 * @param {string} key
 * @returns {Object<string, string[]>}
 */
export function normalisePerSubmodule(value, where, key) {
  let items
  if (isObject(value)) {
    items = Object.entries(value)
  } else if (Array.isArray(value)) {
    items = value.flatMap((item, i) => {
      if (!isObject(item) || Object.keys(item).length !== 1) {
        throw new Error(
          `${where}: "${key}"[${i}] must be an object with exactly one key (a submodule name), not ${pyRepr(item)}.`
        )
      }
      return Object.entries(item)
    })
  } else {
    throw new Error(
      `${where}: "${key}" must be an object {submodule: [hosts]} or a list of one-key objects, not ${pyRepr(value)}.`
    )
  }
  const out = {}
  for (const [sub, hosts] of items) {
    if (sub in out) throw new Error(`${where}: "${key}" lists submodule "${sub}" twice.`)
    if (sub.includes('/')) parsePathReference(sub, where, key)
    out[sub] = nameList(hosts, where, `${key}.${sub}`)
  }
  return out
}

function recordWhere(source, index, record, what) {
  let where = what && source ? `${what} ${source}` : source || what
  if (index !== undefined && index !== null) where += `, record ${index}`
  if (isObject(record) && typeof record.name === 'string') where += ` ("${record.name}")`
  return where
}

/**
 * One module-array record, in either key style, in PhLynx keys: name, module_type, module_subtype, inp_instances and
 * out_instances (lists of names) first, then the other keys as they were, per_submodule_* as ordered objects and
 * parameterisation trimmed. The older `instance` key is read as `parameterisation` (CA refuses it; PhLynx reads
 * legacy files). `record` itself is not changed.
 *
 * @param {*} record
 * @param {Object} [options]
 * @param {string} [options.source] - The file, for messages.
 * @param {number} [options.index]
 * @param {string|null} [options.what] - What the record is in, 'module array' unless null.
 * @returns {Object}
 * @throws {Error} naming the file, record and key: not an object, mixed key styles, a missing or spaced
 *   name/type/subtype, a malformed list or a bad parameterisation name.
 */
export function normaliseModuleRecord(record, { source, index, what = 'module array' } = {}) {
  const where = recordWhere(source, index, record, what)
  if (!isObject(record)) throw new Error(`${where} is a ${pyType(record)}, not a JSON object: ${pyRepr(record)}`)
  const phlynxKeys = Object.keys(PHLYNX_ARRAY_KEYS).filter((key) => key in record)
  const libcuflynxKeys = LIBCUFLYNX_ONLY_KEYS.filter((key) => key in record)
  if (phlynxKeys.length && libcuflynxKeys.length) {
    throw new Error(
      `${where} mixes libcuflynx keys ${pyRepr(libcuflynxKeys)} and PhLynx keys ${pyRepr(phlynxKeys)}. Use either ` +
        `name/vessel_type/BC_type/inp_vessels/out_vessels or name/module_type/module_subtype/inp_instances/out_instances.`
    )
  }
  const rename = phlynxKeys.length ? {} : LIBCUFLYNX_ARRAY_KEYS
  const [typeKey, subtypeKey] = phlynxKeys.length ? ['module_type', 'module_subtype'] : ['vessel_type', 'BC_type']
  for (const key of ['name', typeKey, subtypeKey]) {
    const value = record[key]
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${where}: "${key}" is required and must be a non-empty string (got ${pyRepr(value)}).`)
    }
    if (value.trim().split(/\s+/).length > 1) {
      throw new Error(
        `${where}: "${key}" ${pyRepr(value)} contains whitespace. Names, module types and versions cannot contain ` +
          `spaces; use underscores.`
      )
    }
  }
  const out = {
    name: record.name.trim(),
    module_type: record[typeKey].trim(),
    module_subtype: record[subtypeKey].trim(),
  }
  const renamed = mergeRenamedKey(record, PARAMETERISATION_KEY, INSTANCE_KEY, where)
  for (const [key, value] of Object.entries(renamed)) {
    const newKey = rename[key] ?? key
    if (['name', 'module_type', 'module_subtype'].includes(newKey)) continue
    if (LIST_KEYS.includes(newKey)) out[newKey] = nameList(value, where, key)
    else if (PER_SUBMODULE_KEYS.includes(newKey)) out[newKey] = normalisePerSubmodule(value, where, key)
    else if (newKey === PARAMETERISATION_KEY) out[newKey] = checkParameterisationName(value, where, key)
    else out[newKey] = value
  }
  for (const key of LIST_KEYS) out[key] ??= []
  const ordered = Object.fromEntries(RECORD_KEYS.map((key) => [key, out[key]]))
  return Object.assign(ordered, Object.fromEntries(Object.entries(out).filter(([key]) => !RECORD_KEYS.includes(key))))
}

/**
 * The records of one module array, each normalised on its own (see normaliseModuleRecord).
 *
 * @param {*} records - The parsed JSON.
 * @param {string} [source]
 * @returns {Object[]}
 */
export function normaliseModuleRecords(records, source) {
  if (!Array.isArray(records)) {
    throw new Error(`module array ${source ?? ''} must be a JSON list of records, not a ${pyType(records)}.`)
  }
  return records.map((record, index) => normaliseModuleRecord(record, { source, index }))
}

/**
 * Which layout a CSV module array's columns are in.
 *
 * @param {string[]} columns
 * @param {string} [source]
 * @returns {'phlynx'|'libcuflynx'|null} Null when it has none of either's columns.
 * @throws {Error} for columns of both layouts.
 */
export function moduleArrayLayout(columns, source) {
  const phlynx = ['module_subtype', 'inp_instances', 'out_instances'].filter((c) => columns.includes(c))
  const libcuflynx = LIBCUFLYNX_ONLY_KEYS.filter((c) => columns.includes(c))
  if (phlynx.length && libcuflynx.length) {
    throw new Error(
      `module array${source ? ` ${source}` : ''} mixes libcuflynx columns ${pyRepr(libcuflynx)} and PhLynx columns ` +
        `${pyRepr(phlynx)}. Use either name,BC_type,vessel_type,inp_vessels,out_vessels or ` +
        `name,module_type,module_subtype,inp_instances,out_instances.`
    )
  }
  if (phlynx.length || columns.includes('module_type')) return 'phlynx'
  return libcuflynx.length ? 'libcuflynx' : null
}

const firstToken = (cell) => (typeof cell === 'string' ? cell.split(/\s+/).filter(Boolean)[0] ?? '' : '')

/**
 * The rows of a CSV module array (either layout) as raw records, as CA reads them: inp/out cells split on whitespace,
 * every other cell cut to its first word, and an empty optional cell (e.g. parameterisation) left out.
 *
 * @param {Object<string, string>[]} rows - Rows keyed by column.
 * @param {string[]} columns
 * @returns {Object[]}
 */
export function moduleArrayCsvToRecords(rows, columns) {
  const listColumns = ['inp_instances', 'out_instances', 'inp_vessels', 'out_vessels']
  const baseColumns = [...MODULE_ARRAY_COLUMNS.phlynx, ...MODULE_ARRAY_COLUMNS.libcuflynx]
  return rows.map((row) => {
    const record = {}
    for (const column of columns) {
      const cell = row[column]
      if (listColumns.includes(column)) record[column] = typeof cell === 'string' ? cell.split(/\s+/).filter(Boolean) : []
      else if (baseColumns.includes(column) || firstToken(cell) !== '') record[column] = firstToken(cell)
    }
    return record
  })
}

/**
 * Whether a record is, or looks like, a super-module instance: CA's own test, before the type is looked up.
 *
 * @param {Object} record - A normalised record.
 * @returns {boolean}
 */
export function looksLikeSupermoduleInstance(record) {
  return record.module_subtype === SUPERMODULE_FORMAT || PER_SUBMODULE_KEYS.some((key) => key in record)
}

/**
 * Normalised records as the rows buildWorkflowGraph reads: inp/out lists joined by spaces, every other key kept.
 *
 * @param {Object[]} records
 * @returns {Object[]}
 */
export function toInstanceRows(records) {
  return records.map((record) => ({
    ...record,
    inp_instances: record.inp_instances.join(' '),
    out_instances: record.out_instances.join(' '),
  }))
}
