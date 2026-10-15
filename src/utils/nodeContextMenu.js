/**
 * The items of a canvas node's context menu.
 */
import { SUBSYSTEM_NODE_TYPE } from './constants'

/**
 * Builds a canvas node's context menu: a subsystem's Open, Edit Super-module and Delete, or a module's Replace Module,
 * with Simulate for either. A super-module edited on its own stands for every copy of it, so then there is no Simulate.
 *
 * @param {Object} options
 * @param {Object} options.node - The node right-clicked.
 * @param {boolean} options.isEditingSupermodule
 * @param {string} options.simulateLabel - What Simulate runs, such as `Simulate Selection (2)`.
 * @param {Object} options.actions - `open`, `editSupermodule`, `remove`, `replace` and `simulate`, each given the node.
 * @returns {{label: string, action: Function}[]}
 */
export function nodeContextMenuItems({ node, isEditingSupermodule, simulateLabel, actions }) {
  const simulate = isEditingSupermodule ? [] : [{ label: simulateLabel, action: () => actions.simulate(node) }]
  if (node.type === SUBSYSTEM_NODE_TYPE) {
    return [
      { label: 'Open', action: () => actions.open(node) },
      { label: 'Edit Super-module', action: () => actions.editSupermodule(node) },
      ...simulate,
      { label: 'Delete', action: () => actions.remove(node) },
    ]
  }
  return [{ label: 'Replace Module', action: () => actions.replace(node) }, ...simulate]
}
