import { useConfirm } from 'primevue/useconfirm'

// export interface AppConfirmOptions {
//   message: string
//   header?: string
//   severity?: 'info' | 'success' | 'warning' | 'error'
//   acceptLabel?: string
//   rejectLabel?: string
// }

export function useConfirmDialog() {
  const confirm = useConfirm()

  /**
   * Shows the app's confirm dialog.
   *
   * @param {Object} options
   * @returns {Promise<boolean|null>} True on accept, false on reject, null when closed without an answer (Escape).
   */
  function showConfirm(options) {
    return new Promise((resolve) => {
      confirm.require({
        group: 'app-confirm',

        header: options.header,
        message: options.message,
        severity: options.severity,

        acceptLabel: options.acceptLabel ?? 'OK',
        rejectLabel: options.rejectLabel,

        accept: () => resolve(true),
        reject: () => resolve(false),
        // Accept and reject resolve first, so this only settles a dialog closed without an answer.
        onHide: () => resolve(null),
      })
    })
  }

  async function confirmDialog(options) {
    return await showConfirm(options)
  }

  async function alertDialog(options) {
    return await showConfirm({
      ...options,
      acceptLabel: options.acceptLabel ?? 'OK',
      rejectLabel: undefined,
    })
  }

  return {
    confirm: confirmDialog,
    alert: alertDialog,
  }
}