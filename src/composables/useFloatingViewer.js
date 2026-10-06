/**
 * Shows or hides the floating simulation viewer, a small window of the results that stays over the canvas
 * while the model is edited. WorkspaceArea shows it.
 */
import { reactive } from 'vue'

const state = reactive({ visible: false })

/**
 * Gives the viewer's shared state, and ways to show or hide it.
 *
 * @returns {{state: {visible: boolean}, toggle: Function}}
 */
export function useFloatingViewer() {
  return {
    state,
    toggle: () => (state.visible = !state.visible),
  }
}
