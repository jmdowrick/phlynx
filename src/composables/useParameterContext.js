/**
 * Where the parameter sidebar's rows come from, and where its edits go, for the node selected on the canvas: a root
 * module's own rows; inside a subsystem entered from the root, the values the model has there, each edit this
 * subsystem's override by default or the super-module's default; inside a super-module edited on its own, its child's
 * own rows, with how every copy of it is supplied.
 */
import { useCanvasLevel } from './useCanvasLevel'
import { useModelGraph } from './useModelGraph'
import { useModelWriter } from './useModelWriter'
import { useNodeDataHistory } from './useNodeDataHistory'
import { FLOW_IDS } from '../utils/constants'
import { scopeOf } from '../utils/hierarchy'

/**
 * Gives the parameter context of selected nodes.
 *
 * @param {string} [flowId=FLOW_IDS.MAIN]
 */
export function useParameterContext(flowId = FLOW_IDS.MAIN) {
  const level = useCanvasLevel(flowId)
  const model = useModelGraph(flowId)
  const writer = useModelWriter()
  const { recordEdit } = useNodeDataHistory(flowId)

  /**
   * Says how a node's rows are shown and written.
   *
   * @param {Object|null} node - A store node on the canvas.
   * @returns {{mode: 'root'|'instance'|'supermodule', modelId: string|null}} 'instance' for a module of a subsystem
   *   entered from the root, by its model id; 'supermodule' for one of a super-module edited on its own, by its store
   *   id.
   */
  function contextOf(node) {
    if (!node || scopeOf(node) === null) return { mode: 'root', modelId: node?.id ?? null }
    const modelId = level.isEditingSupermodule.value ? undefined : model.modelIdOf(node.id, level.instancePath.value)
    return modelId ? { mode: 'instance', modelId } : { mode: 'supermodule', modelId: node.id }
  }

  /**
   * Gets the rows a node shows: inside a subsystem, the model's, overrides applied.
   *
   * @param {Object} node
   * @returns {Array}
   */
  function rowsOf(node) {
    const { mode, modelId } = contextOf(node)
    return (mode === 'instance' ? model.findModelNode(modelId)?.data?.variables : node?.data?.variables) ?? []
  }

  /**
   * Says where each of a node's values comes from: in a subsystem, its chip and #686 status (see
   * useModelWriter.provenanceOf); in a super-module edited on its own, a summary across its copies (see
   * aggregateProvenanceOf); nothing at the root.
   *
   * @param {Object} node
   * @returns {Map<string, Object>} By row name.
   */
  function provenanceOf(node) {
    const { mode, modelId } = contextOf(node)
    if (mode === 'instance') return writer.provenanceOf(modelId)
    if (mode === 'supermodule') return writer.aggregateProvenanceOf(modelId)
    return new Map()
  }

  /**
   * Gets where an edit goes: a module of a super-module edited on its own can only take the super-module's default.
   *
   * @param {Object} node
   * @param {'instance'|'supermodule'} chosen - The edit target the user picked.
   * @returns {'instance'|'supermodule'}
   */
  const targetFor = (node, chosen) => (contextOf(node).mode === 'supermodule' ? 'supermodule' : chosen)

  /**
   * Writes one row's fields as one undo step, where the target puts it: for this subsystem only the value, as its
   * override.
   *
   * @param {Object} node
   * @param {string} variable
   * @param {Object} patch
   * @param {Object} [options]
   * @param {'instance'|'supermodule'} [options.target='instance']
   * @param {Function} [options.alsoApply] - Run in the same step first, such as a global constant's shared value.
   * @returns {Array|null} The rows written.
   */
  function writeRow(node, variable, patch, { target = 'instance', alsoApply = null } = {}) {
    const { mode, modelId } = contextOf(node)
    const chosen = targetFor(node, target)
    const isOverride = mode === 'instance' && chosen === 'instance'
    const written = isOverride ? { value: patch.value } : patch
    let rows = null
    recordEdit({
      type: isOverride ? 'edit-override' : 'edit-parameters',
      ...writer.recordTargetOf(modelId, { target: chosen }),
      apply: () => {
        alsoApply?.()
        rows = writer.writeValue(modelId, variable, written, { target: chosen })
      },
    })
    return rows
  }

  /**
   * Resets this subsystem's override of a value, as one undo step.
   *
   * @param {Object} node
   * @param {string} variable
   */
  function resetRow(node, variable) {
    const { mode, modelId } = contextOf(node)
    if (mode !== 'instance') return
    recordEdit({
      type: 'reset-override',
      ...writer.recordTargetOf(modelId),
      apply: () => writer.resetOverride(modelId, variable),
    })
  }

  // The expanded model, which rows shown from it follow.
  return { contextOf, rowsOf, provenanceOf, targetFor, writeRow, resetRow, graph: model.graph }
}
