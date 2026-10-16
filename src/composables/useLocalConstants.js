/**
 * A super-module's local constants (#445; see services/hierarchy/localConstants.js): declare, edit and remove them,
 * each as one undo step, and find what can be declared and what uses each one. Values set here are the super-module's
 * defaults; each super instance overrides them through the parameter sidebar.
 */
import { useVueFlow } from '@vue-flow/core'

import { useNodeDataHistory } from './useNodeDataHistory'
import {
  boundChildren,
  isLocalConstantRow,
  LOCAL_CONSTANT_TYPE,
  localConstantNameProblem,
  localConstantsOf,
  planLocalConstantRemoval,
  planShadowedOverrideRemoval,
} from '../services/hierarchy/localConstants'
import { withDeclaration } from '../services/hierarchy/overrides'
import { useLibraryStore } from '../stores/libraryStore'
import { FLOW_IDS } from '../utils/constants'
import { indexByScope, isSuperInstance, isSupermoduleInterface, localIdOf } from '../utils/hierarchy'
import { notify } from '../utils/notify'
import { detachReactivity } from '../utils/reactivity'

/**
 * Gives the commands on super-modules' local constants.
 *
 * @param {string} [flowId=FLOW_IDS.MAIN]
 */
export function useLocalConstants(flowId = FLOW_IDS.MAIN) {
  const { nodes, findNode, updateNodeData } = useVueFlow(flowId)
  const { recordEdit } = useNodeDataHistory(flowId)
  const libraryStore = useLibraryStore()

  /** @returns {Array} A super-module's declarations. */
  const declarationsOf = (smId) => localConstantsOf(findNode(smId))

  /** @returns {Array} A super-module's direct leaf children. */
  const leavesOf = (smId) => (indexByScope(nodes.value).get(smId) ?? []).filter((node) => !isSuperInstance(node) && !isSupermoduleInterface(node))

  /**
   * Lists what a super-module could declare: its modules' constants not yet declared, each name once, with the units
   * and value of the first.
   *
   * @param {string} smId
   * @returns {Array<{name: string, units: string, value: string, count: number}>} count: the modules with a row of it.
   */
  function candidatesOf(smId) {
    const declared = new Set(declarationsOf(smId).map((declaration) => declaration.name))
    const byName = new Map()
    for (const leaf of leavesOf(smId)) {
      for (const row of leaf.data?.variables ?? []) {
        if ((row.type !== 'constant' && !isLocalConstantRow(row)) || declared.has(row.name)) continue
        if (!byName.has(row.name)) byName.set(row.name, { name: row.name, units: row.units ?? '', value: row.value ?? '', count: 0 })
        byName.get(row.name).count++
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  /** @returns {Array} The modules of a super-module bound to one of its local constants. */
  const usageOf = (smId, name) => boundChildren(nodes.value, smId, name)

  /** @returns {string|null} Why a name can't be declared on a super-module. */
  const nameProblemOf = (smId, name) =>
    localConstantNameProblem(name, { declarations: declarationsOf(smId), globalNames: libraryStore.globalVariables.keys() })

  /**
   * Declares a local constant, as one undo step.
   *
   * @param {string} smId
   * @param {{name: string, units: string, value: string}} declaration
   * @param {Object} [options]
   * @param {boolean} [options.bind=false] - Binds the modules' constants of its name and units to it.
   * @returns {Promise<boolean>} Whether it was declared.
   * @throws {Error} When the name can't be used.
   */
  async function declare(smId, { name, units = '', value = '' }, { bind = false } = {}) {
    const trimmed = (name ?? '').trim()
    const problem = nameProblemOf(smId, trimmed)
    if (problem) throw new Error(problem)
    const bound = bind ? leavesOf(smId).filter((leaf) => (leaf.data?.variables ?? []).some((row) => isBindable(row, trimmed, units))) : []
    // The bound rows' overrides set nothing once they take the local constant's value.
    const shadowed = planShadowedOverrideRemoval(nodes.value, smId, new Map(bound.map((leaf) => [localIdOf(leaf), [trimmed]])))
    return recordEdit({
      type: 'declare-local-constant',
      nodeIds: [smId, ...bound.map((leaf) => leaf.id), ...shadowed.changes.keys()],
      keys: ['supermodule', 'variables', 'overrides'],
      apply: () => {
        applyShadowedOverrideRemoval(shadowed, updateNodeData)
        const definition = findNode(smId).data.supermodule
        const localConstants = [...(definition.localConstants ?? []), { name: trimmed, units, value: String(value ?? '') }]
        updateNodeData(smId, { supermodule: detachReactivity({ ...definition, localConstants }) })
        for (const leaf of bound) {
          const variables = leaf.data.variables.map((row) => (isBindable(row, trimmed, units) ? { ...row, type: LOCAL_CONSTANT_TYPE, value: String(value ?? '') } : row))
          updateNodeData(leaf.id, { variables: detachReactivity(variables) })
        }
      },
    })
  }

  /**
   * Sets a local constant's declared value or units, as one undo step.
   *
   * @param {string} smId
   * @param {string} name
   * @param {{value?: string, units?: string}} patch
   * @returns {Promise<boolean>} Whether it changed.
   */
  function update(smId, name, patch) {
    return recordEdit({
      type: 'edit-local-constant',
      nodeIds: [smId],
      keys: ['supermodule'],
      apply: () => updateNodeData(smId, { supermodule: detachReactivity(withDeclaration(findNode(smId).data.supermodule, name, patch)) }),
    })
  }

  /**
   * Removes a local constant, as one undo step: its rows become constants with its value, and each super instance's
   * override of it an override of each row (see planLocalConstantRemoval).
   *
   * @param {string} smId
   * @param {string} name
   * @returns {Promise<boolean>} Whether it was removed.
   */
  function remove(smId, name) {
    const { changes } = planLocalConstantRemoval(nodes.value, smId, name)
    if (!changes.size) return Promise.resolve(false)
    return recordEdit({
      type: 'remove-local-constant',
      nodeIds: [...changes.keys()],
      keys: ['supermodule', 'variables', 'overrides'],
      apply: () => {
        for (const [id, fields] of changes) updateNodeData(id, detachReactivity(fields))
      },
    })
  }

  return { declarationsOf, candidatesOf, usageOf, nameProblemOf, declare, update, remove }
}

/** @returns {boolean} Whether a row is a constant that can be bound to a local constant of a name and units. */
const isBindable = (row, name, units) => row.type === 'constant' && row.name === name && (!units || !row.units || row.units === units)

/**
 * Drops the overrides a binding to local constants leaves inert (see planShadowedOverrideRemoval), inside the caller's
 * undo step, and says how many per-instance values the local constant replaced, when any.
 *
 * @param {{changes: Map<string, Object>, count: number}} plan
 * @param {Function} updateNodeData
 */
export function applyShadowedOverrideRemoval({ changes, count }, updateNodeData) {
  for (const [id, fields] of changes) updateNodeData(id, detachReactivity(fields))
  if (!count) return
  const values = count === 1 ? '1 per-instance value' : `${count} per-instance values`
  notify.info({ title: 'Per-Instance Values Replaced', message: `The local constant replaced ${values}, which no longer had an effect.` })
}
