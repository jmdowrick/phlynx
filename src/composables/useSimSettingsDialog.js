/**
 * Opens the Simulation Settings dialog from anywhere, such as the Simulation tab's cog or the instance
 * editor, without passing events up through the components between. WorkspaceArea shows the dialog.
 */
import { reactive } from 'vue'

// The dialog's tabs, by name.
export const SIM_SETTINGS_TABS = { plots: 0, sliders: 1, parameters: 2 }

const state = reactive({ visible: false, initialTab: null })

/**
 * Gives the dialog's shared state, and a way to open it.
 *
 * @returns {{state: {visible: boolean, initialTab: string|null}, open: Function}}
 */
export function useSimSettingsDialog() {
  /**
   * Opens the dialog, on a tab when given one.
   *
   * @param {keyof SIM_SETTINGS_TABS} [tab]
   */
  function open(tab = null) {
    state.initialTab = tab
    state.visible = true
  }

  return { state, open }
}
