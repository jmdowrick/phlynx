import { useConfirm } from 'primevue/useconfirm'

// export interface AppConfirmOptions {
//   message: string
//   header?: string
//   severity?: 'info' | 'success' | 'warning' | 'error'
//   acceptLabel?: string
//   rejectLabel?: string
//   isRejectDefault?: boolean // the reject button is the primary one, and focused
// }

export function useConfirmDialog() {
  const confirm = useConfirm()

  function showConfirm(options) {
    return new Promise((resolve) => {
      confirm.require({
        group: 'app-confirm',

        header: options.header,
        message: options.message,
        severity: options.severity,

        acceptLabel: options.acceptLabel ?? 'OK',
        rejectLabel: options.rejectLabel,
        isRejectDefault: !!options.isRejectDefault && !!options.rejectLabel,

        // Escape closes only this dialog, as its reject button would.
        closeOnEscape: true,
        accept: () => resolve(true),
        reject: () => resolve(false),
        onHide: () => resolve(false),
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