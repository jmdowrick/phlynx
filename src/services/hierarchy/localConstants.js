/**
 * Local constants (#445): constants a super-module declares for its top-level children, as global constants are for
 * the whole model. Pure.
 *
 * A super-module declares `supermodule.localConstants = [{name, units, value}]`. A row of one of its direct children
 * typed `local_constant` binds by its name to the declaration of that name; nested super-modules declare their own.
 * Each super instance can override a value under its LOCAL_CONSTANTS_KEY override (`@` for its own super-module's,
 * `<localId path>/@` for a super instance below it), the outermost winning, as for other overrides.
 *
 * The expansion gives a bound row its effective value and `localConstant: {owner, units}`, owner being its super
 * instance's flat name: flat CellML emits one constant per super instance and name (`<name>_<owner>`), connected to
 * every bound row, and circulatory_autogen writes each row as a constant of its own (see asConstants).
 */
import { indexByScope, isSuperInstance, isSupermoduleInterface, localIdOf, scopeOf, supermodulesById } from '../../utils/hierarchy'
import { EXPANDED_ID_SEPARATOR, isLocalConstantsKey, LOCAL_CONSTANTS_KEY } from './expand'

/** The row type of a variable bound to its super-module's local constant. */
export const LOCAL_CONSTANT_TYPE = 'local_constant'

/** @returns {boolean} Whether a row is bound to a local constant. */
export const isLocalConstantRow = (row) => row?.type === LOCAL_CONSTANT_TYPE

/** @returns {Array<{name: string, units: string, value: string}>} A super-module's (its interface node's) declarations. */
export const localConstantsOf = (supermodule) => supermodule?.data?.supermodule?.localConstants ?? []

/** @returns {string} The flat CellML name of a super instance's local constant. */
export const emittedLocalConstantName = (name, owner) => `${name}_${owner}`

/** @returns {string} The override key, on a super instance, of the local constants of the super instance at a local id path below it. */
export const localConstantsKeyOf = (path = []) => [...path, LOCAL_CONSTANTS_KEY].join(EXPANDED_ID_SEPARATOR)

/**
 * Gets a local constant's value where a chain of super instances expands, applying their overrides innermost first, so
 * the outermost wins.
 *
 * @param {Array} chain - The super instances, outermost first; the innermost's super-module declares the constant.
 * @param {string[]} idPath - Their local ids.
 * @param {string} name
 * @param {*} declared - The declaration's value.
 * @param {number} [fromLevel=0] - The outermost level applied: 1 for the value without the outermost's override.
 * @returns {*}
 */
export function localConstantValue(chain, idPath, name, declared, fromLevel = 0) {
  let value = declared
  for (let level = chain.length - 1; level >= fromLevel; level--) {
    const patch = chain[level]?.data?.overrides?.[localConstantsKeyOf(idPath.slice(level + 1))]?.[name]
    if (patch && 'value' in patch) value = patch.value
  }
  return value
}

/**
 * Says what is wrong with a super-module's declarations: a blank or repeated name, or one a global constant has.
 *
 * @param {Array} declarations
 * @param {Set<string>} globalNames - The global constants' names.
 * @returns {string[]} Each problem in words.
 */
export function declarationProblems(declarations, globalNames) {
  const problems = []
  const seen = new Set()
  for (const { name } of declarations ?? []) {
    if (!name?.trim()) problems.push('has a local constant without a name')
    else if (seen.has(name)) problems.push(`declares local constant "${name}" more than once`)
    else if (globalNames.has(name)) problems.push(`declares local constant "${name}", which is a global constant's name`)
    seen.add(name)
  }
  return problems
}

/**
 * Says why a name can't be a new local constant of a super-module, or null when it can.
 *
 * @param {string} name
 * @param {Object} options
 * @param {Array} options.declarations - The super-module's own.
 * @param {Set<string>|Iterable<string>} options.globalNames
 * @returns {string|null}
 */
export function localConstantNameProblem(name, { declarations = [], globalNames = [] }) {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return 'A local constant needs a name.'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) return 'A name has only letters, digits and "_", and does not start with a digit.'
  if (declarations.some((declaration) => declaration.name === trimmed)) return `"${trimmed}" is already a local constant here.`
  if (new Set(globalNames).has(trimmed)) return `"${trimmed}" is a global constant.`
  return null
}

/**
 * Turns local constant rows into constants: those the expansion bound keep their value; with valueOf, any it gives a
 * value. Others are kept as they are.
 *
 * @param {Array} rows
 * @param {(row: Object) => *} [valueOf] - A row's value, undefined to keep it.
 * @returns {Array}
 */
export function asConstants(rows, valueOf = (row) => (row.localConstant ? row.value : undefined)) {
  if (!(rows ?? []).some(isLocalConstantRow)) return rows
  return rows.map((row) => {
    if (!isLocalConstantRow(row)) return row
    const value = valueOf(row)
    if (value === undefined) return row
    const { localConstant: _bound, ...rest } = row
    return { ...rest, type: 'constant', value }
  })
}

/**
 * Gives a super-module's direct leaf children bound to one of its local constants, or to any.
 *
 * @param {Array} nodes - Every node in the store.
 * @param {string} smId
 * @param {string} [name] - One constant's.
 * @returns {Array} The children.
 */
export function boundChildren(nodes, smId, name) {
  return (indexByScope(nodes).get(smId) ?? []).filter(
    (node) =>
      !isSuperInstance(node) &&
      !isSupermoduleInterface(node) &&
      (node.data?.variables ?? []).some((row) => isLocalConstantRow(row) && (name === undefined || row.name === name))
  )
}

/**
 * Lists every override of local constants in the store: each super instance's key, the super-module whose
 * constants it sets, and the local ids from that super instance down to the one it sets them for.
 *
 * @param {Array} nodes
 * @returns {Array<{instance: Object, key: string, path: string[], smId: string|null, patches: Object}>} smId null where
 *   the path no longer reaches a super instance.
 */
export function localConstantOverrides(nodes) {
  return overridesThrough(nodes, true)
}

/**
 * Lists every super instance's overrides of one kind: of local constants (keys ending in '@'), or of rows (the path
 * ending in the module's local id), each with the super-module the path (without that last local id) reaches.
 */
function overridesThrough(nodes, isLocal) {
  const byScope = indexByScope(nodes)
  const childOf = (smId, localId) => (byScope.get(smId) ?? []).find((node) => !isSupermoduleInterface(node) && localIdOf(node) === localId)
  const found = []
  for (const instance of nodes) {
    if (!isSuperInstance(instance)) continue
    for (const [key, patches] of Object.entries(instance.data?.overrides ?? {})) {
      if (isLocalConstantsKey(key) !== isLocal) continue
      const path = key.split(EXPANDED_ID_SEPARATOR).slice(0, -1)
      let smId = instance.data.smId
      for (const localId of path) {
        const child = childOf(smId, localId)
        smId = isSuperInstance(child) ? child.data.smId : null
        if (!smId) break
      }
      found.push({ instance, key, path, smId, patches: patches ?? {} })
    }
  }
  return found
}

/**
 * Plans removing a local constant: its rows become constants with the declared value, and every super instance's
 * override of it becomes an override of each of those rows, so the model is as it was.
 *
 * @param {Array} nodes - Every node in the store.
 * @param {string} smId
 * @param {string} name
 * @returns {{changes: Map<string, Object>, bound: Array}} changes: each node's data fields to set (supermodule,
 *   variables, overrides); bound: the children whose rows were bound.
 */
export function planLocalConstantRemoval(nodes, smId, name) {
  const supermodule = supermodulesById(nodes).get(smId)
  const declarations = localConstantsOf(supermodule)
  const declaration = declarations.find((candidate) => candidate.name === name)
  const changes = new Map()
  if (!declaration) return { changes, bound: [] }
  changes.set(smId, { supermodule: { ...supermodule.data.supermodule, localConstants: declarations.filter((candidate) => candidate !== declaration) } })
  const bound = boundChildren(nodes, smId, name)
  for (const child of bound) {
    changes.set(child.id, {
      variables: child.data.variables.map((row) => (isLocalConstantRow(row) && row.name === name ? { ...row, type: 'constant', value: declaration.value } : row)),
    })
  }
  // An override of a bound row set nothing (the local constant won), so it goes rather than take effect now.
  planShadowedOverrideRemoval(nodes, smId, new Map(bound.map((child) => [localIdOf(child), [name]])), changes)
  for (const { instance, key, path, smId: target, patches } of localConstantOverrides(nodes)) {
    if (target !== smId || !(name in patches)) continue
    const overrides = { ...(changes.get(instance.id)?.overrides ?? instance.data.overrides) }
    const { [name]: patch, ...rest } = overrides[key] ?? {}
    if (Object.keys(rest).length) overrides[key] = rest
    else delete overrides[key]
    for (const child of bound) {
      const childKey = [...path, localIdOf(child)].join(EXPANDED_ID_SEPARATOR)
      overrides[childKey] = { ...overrides[childKey], [name]: { ...patch } }
    }
    changes.set(instance.id, { overrides })
  }
  return { changes, bound }
}

/**
 * Plans dropping every super instance's overrides of rows of a super-module's children that are (or become) bound to
 * its local constants: a bound row takes the local constant's value, so they set nothing.
 *
 * @param {Array} nodes - Every node in the store.
 * @param {string} smId
 * @param {Map<string, Iterable<string>>} rowsByLocalId - Each child's local id to the names of its bound rows.
 * @param {Map<string, Object>} [changes=new Map()] - Changes planned already, which these add to.
 * @returns {{changes: Map<string, Object>, count: number}} changes: each super instance's overrides to set; count: the
 *   overrides dropped.
 */
export function planShadowedOverrideRemoval(nodes, smId, rowsByLocalId, changes = new Map()) {
  let count = 0
  for (const { instance, key, smId: target, patches } of overridesThrough(nodes, false)) {
    const names = target === smId ? [...(rowsByLocalId.get(key.split(EXPANDED_ID_SEPARATOR).at(-1)) ?? [])] : []
    const shadowed = names.filter((name) => name in patches)
    if (!shadowed.length) continue
    const overrides = { ...(changes.get(instance.id)?.overrides ?? instance.data.overrides) }
    const rest = Object.fromEntries(Object.entries(overrides[key]).filter(([name]) => !shadowed.includes(name)))
    if (Object.keys(rest).length) overrides[key] = rest
    else delete overrides[key]
    changes.set(instance.id, { ...changes.get(instance.id), overrides })
    count += shadowed.length
  }
  return { changes, count }
}

/**
 * Plans what binding a super-module child's rows to local constants by retyping them drops: the overrides of the rows
 * newly bound (see planShadowedOverrideRemoval).
 *
 * @param {Array} nodes - Every node in the store.
 * @param {Object} child - The store node whose rows are written.
 * @param {Array} rows - Its rows after the edit.
 * @returns {{changes: Map<string, Object>, count: number}} Nothing when no row becomes bound.
 */
export function planRetypeBinding(nodes, child, rows) {
  const smId = scopeOf(child)
  const names = smId ? newlyBoundNames(child.data?.variables, rows, localConstantsOf(supermodulesById(nodes).get(smId))) : []
  return names.length ? planShadowedOverrideRemoval(nodes, smId, new Map([[localIdOf(child), names]])) : { changes: new Map(), count: 0 }
}

/**
 * Gives the names of a super-module child's rows an edit binds to the super-module's local constants: typed local
 * constant after, not before, and declared.
 *
 * @param {Array} before - Its rows.
 * @param {Array} after
 * @param {Array} declarations - The super-module's.
 * @returns {string[]}
 */
function newlyBoundNames(before, after, declarations) {
  const declared = new Set(declarations.map((declaration) => declaration.name))
  const wasBound = new Set((before ?? []).filter(isLocalConstantRow).map((row) => row.name))
  return (after ?? []).filter((row) => isLocalConstantRow(row) && declared.has(row.name) && !wasBound.has(row.name)).map((row) => row.name)
}
