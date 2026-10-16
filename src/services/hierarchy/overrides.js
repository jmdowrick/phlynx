/**
 * Values of modules inside super instances: where an edit is written, what a value would be without this super instance's
 * override, and where each value comes from. Pure.
 *
 * A module inside a super instance has a model id of local ids joined with '/' (`dndnode_1/bed/cap`). An edit for "this
 * super instance" is an override on the outermost super instance, the root node the id starts with, keyed by the rest of the
 * path (`bed/cap`), as expandHierarchy reads overrides; one for "the super-module" changes the child's own row, so
 * every super instance of it has the value unless it overrides it.
 */
import { resolveBoundaryValues } from '../export/boundaryValues'
import { indexByScope, isSuperInstance, isSupermoduleInterface, localIdOf, scopeOf } from '../../utils/hierarchy'
import { EXPANDED_ID_SEPARATOR, isLocalConstantsKey } from './expand'

/** The fields of a row an override sets. */
export const OVERRIDE_FIELDS = ['value']

/** Where an edit is stored: 'instance' on this super instance, 'supermodule' on the super-module's child. */
export const WRITE_TARGETS = Object.freeze(['instance', 'supermodule'])

/**
 * Finds where a write to a model node's values goes.
 *
 * @param {string} modelId - A model id, or the store id of a node inside a super-module (edited on its own).
 * @param {'instance'|'supermodule'} target
 * @param {Map<string, {mainId: string, instanceChain: string[]}>} origin - From expandHierarchy.
 * @param {(id: string) => Object|undefined} findNode - The store's node of an id.
 * @returns {{nodeId: string, field: 'variables'}|{nodeId: string, field: 'overrides', key: string}|{problem: string}|null}
 *   The node and field written: its own rows, or its overrides under a key; why it can't be written; or null for a
 *   node that isn't there.
 */
export function writeTargetOf(modelId, target, origin, findNode) {
  if (!WRITE_TARGETS.includes(target)) throw new Error(`Unknown write target "${target}".`)
  const from = origin.get(modelId)
  if (!from) {
    const node = findNode(modelId)
    if (!node) return null
    if (scopeOf(node) === null || target === 'supermodule') return { nodeId: node.id, field: 'variables' }
    return { problem: 'A module of a super-module edited on its own has no super instance to set a value on: change the super-module’s value.' }
  }
  if (!from.instanceChain.length || target === 'supermodule') return findNode(from.mainId) ? { nodeId: from.mainId, field: 'variables' } : null
  const [rootId] = from.instanceChain
  return findNode(rootId) ? { nodeId: rootId, field: 'overrides', key: keyOf(modelId) } : null
}

/** @returns {string} A nested model id's override key on its outermost super instance: its path below it. */
export const keyOf = (modelId) => modelId.split(EXPANDED_ID_SEPARATOR).slice(1).join(EXPANDED_ID_SEPARATOR)

/**
 * Gets a module's rows inside a super instance as they would be without the outermost super instance's overrides: its own rows
 * with every inner super instance's applied, innermost first. What "reset" goes back to.
 *
 * @param {string} modelId
 * @param {{mainId: string, instanceChain: string[]}} from - Its origin.
 * @param {(id: string) => Object|undefined} findNode
 * @returns {Array} Rows; none for a module that isn't there.
 */
export function inheritedRows(modelId, from, findNode) {
  let rows = findNode(from.mainId)?.data?.variables ?? []
  const ids = modelId.split(EXPANDED_ID_SEPARATOR)
  for (let level = from.instanceChain.length - 1; level >= 1; level--) {
    const patches = findNode(from.instanceChain[level])?.data?.overrides?.[ids.slice(level + 1).join(EXPANDED_ID_SEPARATOR)]
    if (patches) rows = rows.map((row) => (patches[row.name] ? { ...row, ...patches[row.name] } : row))
  }
  return rows
}

/**
 * Sets, or clears, overrides of a super instance under one key. A value the module would have anyway clears its override,
 * so overrides only ever hold what differs.
 *
 * @param {Object} overrides - The super instance's overrides now; not changed.
 * @param {string} key
 * @param {Object<string, Object|null>} patches - Variable name to the fields to set, or null to clear its override.
 * @param {Array} inherited - The module's rows without this super instance's overrides (see inheritedRows).
 * @returns {Object} The new overrides.
 */
export function withOverrides(overrides, key, patches, inherited) {
  const byName = new Map(inherited.map((row) => [row.name, row]))
  const entry = { ...(overrides?.[key] ?? {}) }
  for (const [name, patch] of Object.entries(patches)) {
    const fields = Object.fromEntries(Object.entries(patch ?? {}).filter(([field]) => OVERRIDE_FIELDS.includes(field)))
    const merged = { ...entry[name], ...fields }
    const row = byName.get(name)
    const isInherited = !patch || (row && Object.entries(merged).every(([field, value]) => String(row[field] ?? '') === String(value ?? '')))
    if (isInherited || !Object.keys(merged).length) delete entry[name]
    else entry[name] = merged
  }
  const next = { ...(overrides ?? {}) }
  if (Object.keys(entry).length) next[key] = entry
  else delete next[key]
  return next
}

/**
 * Says where each of a module's values comes from, for the parameter table: its value, the value without this
 * super instance's override, whether this super instance overrides it, and whether export ignores it (#686), with the chip to
 * show: 'ignored', else 'overridden', else 'default'.
 *
 * @param {string} modelId
 * @param {{nodes: Array, edges: Array, origin: Map}} model - From expandHierarchy.
 * @param {(id: string) => Object|undefined} findNode
 * @param {Object} [options]
 * @param {ReturnType<typeof resolveBoundaryValues>} [options.boundary] - The model's, when already resolved.
 * @returns {Map<string, {value: *, inherited: *, isOverridden: boolean, isIgnored: boolean, status: Object|null,
 *   chip: 'default'|'overridden'|'ignored'}>} By row name; empty for a model node that isn't there.
 */
export function provenanceOf(modelId, model, findNode, { boundary = resolveQuietly(model) } = {}) {
  const node = model.nodes.find((candidate) => candidate.id === modelId)
  const from = model.origin.get(modelId)
  if (!node || !from) return new Map()
  const nested = from.instanceChain.length > 0
  const own = nested ? findNode(from.instanceChain[0])?.data?.overrides?.[keyOf(modelId)] ?? {} : {}
  const inherited = new Map((nested ? inheritedRows(modelId, from, findNode) : node.data.variables ?? []).map((row) => [row.name, row]))
  const ignored = boundary?.ignored.get(modelId)
  const statuses = boundary?.status.get(modelId)
  return new Map(
    (node.data.variables ?? []).map((row) => {
      const isOverridden = row.name in own
      const isIgnored = !!ignored?.has(row.name)
      return [
        row.name,
        {
          value: row.value,
          inherited: inherited.get(row.name)?.value,
          isOverridden,
          isIgnored,
          status: statuses?.get(row.name) ?? null,
          chip: isIgnored ? 'ignored' : isOverridden ? 'overridden' : 'default',
        },
      ]
    })
  )
}

/**
 * Sums up, for a module of a super-module edited on its own, where each of its values comes from across every copy of
 * it in the model: how many copies a connection supplies it in, ignore it, or override it.
 *
 * @param {string} mainId - The module's store id.
 * @param {{nodes: Array, edges: Array, origin: Map}} model - From expandHierarchy.
 * @param {(id: string) => Object|undefined} findNode
 * @returns {Map<string, {total: number, counts: Object<string, number>, ignored: number, overridden: number,
 *   summary: string}>} By row name. counts: copies by #686 state ('none' for no state); summary as "connected in
 *   2/3", or the one state every copy shares.
 */
export function aggregateProvenance(mainId, model, findNode) {
  const copies = model.nodes.filter((node) => model.origin.get(node.id)?.mainId === mainId).map((node) => node.id)
  const boundary = resolveQuietly(model)
  const byName = new Map()
  for (const id of copies) {
    for (const [name, info] of provenanceOf(id, model, findNode, { boundary })) {
      if (!byName.has(name)) byName.set(name, { total: 0, counts: {}, ignored: 0, overridden: 0 })
      const entry = byName.get(name)
      const state = info.status?.state ?? 'none'
      entry.total++
      entry.counts[state] = (entry.counts[state] ?? 0) + 1
      if (info.isIgnored) entry.ignored++
      if (info.isOverridden) entry.overridden++
    }
  }
  for (const entry of byName.values()) entry.summary = summarise(entry)
  return byName
}

/** @returns {string} A row's aggregate in words: its one state, or its commonest with how many copies have it. */
function summarise({ total, counts }) {
  const states = Object.entries(counts).filter(([state]) => state !== 'none').sort((a, b) => b[1] - a[1])
  if (!states.length) return ''
  const [state, count] = states[0]
  return count === total ? state : `${state} in ${count}/${total}`
}

/** @returns {Object|null} The model's boundary values, or null when a malformed port stops them (export says why). */
function resolveQuietly(model) {
  try {
    return resolveBoundaryValues(model.nodes, model.edges)
  } catch {
    return null
  }
}

/**
 * Lists a super instance's overrides for its sidebar, each with the path of names it sets and whether it still sets
 * anything: an orphaned one, whose module or variable is gone, is kept and flagged, never dropped.
 *
 * @param {string} superInstanceId
 * @param {Array} nodes - Every node in the store.
 * @returns {Array<{key: string, path: string, variable: string, value: *, isOrphaned: boolean}>}
 */
export function overridesOf(superInstanceId, nodes) {
  const superInstance = nodes.find((node) => node.id === superInstanceId)
  if (!isSuperInstance(superInstance)) return []
  const byScope = indexByScope(nodes)
  const childOf = (scope, localId) => (byScope.get(scope) ?? []).find((node) => !isSupermoduleInterface(node) && localIdOf(node) === localId)
  const resolve = (key) => {
    let scope = superInstance.data.smId
    const names = []
    let node = null
    for (const localId of key.split(EXPANDED_ID_SEPARATOR)) {
      node = childOf(scope, localId)
      if (!node) return { names: [...names, localId], node: null }
      names.push(node.data?.name ?? localId)
      if (isSuperInstance(node)) scope = node.data.smId
    }
    return { names, node }
  }
  return Object.entries(superInstance.data.overrides ?? {}).flatMap(([key, patches]) => {
    if (isLocalConstantsKey(key)) return []
    const { names, node } = resolve(key)
    const rows = new Set(isSuperInstance(node) ? [] : (node?.data?.variables ?? []).map((row) => row.name))
    return Object.entries(patches ?? {}).map(([variable, patch]) => ({
      key,
      path: names.join('/'),
      variable,
      value: patch?.value,
      isOrphaned: !rows.has(variable),
    }))
  })
}
