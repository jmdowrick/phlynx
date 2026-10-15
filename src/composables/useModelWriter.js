/**
 * Writes values into the model by model id. A root module's model id is its node's id, so its values are written to
 * its node, through updateNodeData, inside whatever undo step the caller records. A module inside a subsystem would
 * take an override on the subsystem, or a change to its super-module's definition, which isn't written yet (H7).
 */
import { useVueFlow } from '@vue-flow/core'

import { isNestedModelId } from '../services/hierarchy/expand'
import { FLOW_IDS } from '../utils/constants'
import { scopeOf } from '../utils/hierarchy'
import { notify } from '../utils/notify'
import { detachReactivity } from '../utils/reactivity'

const TARGETS = new Set(['instance', 'supermodule'])

/**
 * Gives the writers of the workspace's model.
 *
 * @returns {{writeValue: Function, writeVariables: Function}}
 */
export function useModelWriter() {
  const { findNode, updateNodeData } = useVueFlow(FLOW_IDS.MAIN)

  /**
   * Finds the node a model id's values are written to.
   *
   * @param {string} modelId
   * @param {'instance'|'supermodule'} target
   * @returns {Object|null} Null for a module inside a subsystem, which is told, or a node that isn't there.
   */
  function rootNodeOf(modelId, target) {
    if (!TARGETS.has(target)) throw new Error(`Unknown write target "${target}".`)
    const isNested = isNestedModelId(modelId)
    const node = isNested ? null : (findNode(modelId) ?? null)
    // A module in a super-module's scope is its definition's, as a subsystem's modules are.
    if (isNested || scopeOf(node) !== null) {
      notify.warning({
        title: 'Not yet supported',
        message: 'Values of modules inside a subsystem can’t be changed here yet.',
      })
      return null
    }
    return node
  }

  /**
   * Writes a module's rows.
   *
   * @param {string} modelId
   * @param {Array} variables - Its new rows, all of them.
   * @param {Object} [options]
   * @param {'instance'|'supermodule'} [options.target='instance'] - The instance, or its super-module's definition;
   *   the same for a root module.
   * @returns {Array|null} The rows written, or null when nothing was.
   */
  function writeVariables(modelId, variables, { target = 'instance' } = {}) {
    if (!rootNodeOf(modelId, target)) return null
    updateNodeData(modelId, { variables })
    return variables
  }

  /**
   * Writes fields of one of a module's rows, leaving its other rows as they are. The rows written are copies, so
   * none is shared with the rows they replace.
   *
   * @param {string} modelId
   * @param {string} variable - The row's name.
   * @param {Object} patch - Its fields to change, such as `value`.
   * @param {Object} [options] - As writeVariables.
   * @returns {Array|null} The module's rows written, or null when nothing was.
   */
  function writeValue(modelId, variable, patch, { target = 'instance' } = {}) {
    const node = rootNodeOf(modelId, target)
    if (!node) return null
    const rows = (node.data?.variables ?? []).map((row) => (row.name === variable ? { ...row, ...patch } : row))
    const variables = detachReactivity(rows)
    updateNodeData(modelId, { variables })
    return variables
  }

  return { writeValue, writeVariables }
}
