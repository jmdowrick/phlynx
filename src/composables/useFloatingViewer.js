/**
 * Shows or hides the floating simulation viewer, a small window of the results that stays over the canvas
 * while the model is edited. WorkspaceArea shows it, and says how to return to the Simulation tab.
 */
import { reactive } from 'vue'

const state = reactive({ visible: false })
let showSimulationTab = () => {}

/**
 * Gives the viewer's shared state, and ways to show, hide or leave it.
 *
 * @returns {{state: {visible: boolean}, toggle: Function, returnToTab: Function, setTabOpener: Function}}
 */
export function useFloatingViewer() {
  return {
    state,
    toggle: () => (state.visible = !state.visible),
    /** Closes the viewer and shows the Simulation tab, opening the sidebar if need be. */
    returnToTab: () => {
      state.visible = false
      showSimulationTab()
    },
    /**
     * Says how to show the Simulation tab.
     *
     * @param {Function} opener
     */
    setTabOpener: (opener) => (showSimulationTab = opener),
  }
}
