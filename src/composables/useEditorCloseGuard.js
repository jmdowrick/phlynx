/**
 * Guards a modal editor against closing by accident. A click outside closes it only when pressed and released on its
 * own mask, so a drag that ends outside, e.g. a pan of a diagram, doesn't. Escape closes only the innermost thing
 * open: a popup, menu or dialog above the editor, or a focused text field, before the editor itself.
 */
import { onMounted, onUnmounted } from 'vue'

/** PrimeVue's overlays, which close themselves on Escape. They are appended to the body, outside the editor. */
export const NESTED_POPUP_SELECTOR = [
  '.p-popover',
  '.p-contextmenu',
  '.p-select-overlay',
  '.p-autocomplete-overlay',
  '.p-multiselect-overlay',
  '.p-menu-overlay',
  '.p-tieredmenu-overlay',
  '.p-datepicker-panel',
  '.p-treeselect-overlay',
  '.p-cascadeselect-overlay',
].join(', ')

const TEXT_FIELD_SELECTOR = 'input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea'

/**
 * Checks whether a popup, menu or another dialog is open above the editor.
 *
 * @param {string} maskClass - The editor's mask class.
 * @param {Document} [root=document]
 * @returns {boolean}
 */
export function isNestedPopupOpen(maskClass, root = document) {
  if (root.querySelector(NESTED_POPUP_SELECTOR)) return true
  // Dialogs are stacked by z-index, not by their order on the page, which follows where each was first mounted.
  const zIndex = (element) => Number(root.defaultView?.getComputedStyle(element).zIndex) || 0
  const masks = [...root.querySelectorAll('.p-dialog-mask')]
  const own = masks.find((mask) => mask.classList.contains(maskClass))
  return masks.some((mask) => mask !== own && (!own || zIndex(mask) >= zIndex(own)))
}

/**
 * Listens, while mounted, for clicks outside the editor and for Escape.
 *
 * @param {Object} options
 * @param {() => boolean} options.isOpen - Whether the editor shows.
 * @param {string} options.maskClass - A class on the editor's own mask.
 * @param {() => boolean} [options.ownsEscape] - Whether something in the editor takes Escape itself, e.g. the
 *   CellDL editor while in use.
 * @param {() => void} options.onOutsideClick - A press and release on the mask.
 * @param {() => void} options.onEscape - Escape with nothing nested open.
 * @returns {{onPointerDown: Function, onPointerUp: Function, onKeyDown: Function}} The listeners, for tests.
 */
export function useEditorCloseGuard({ isOpen, maskClass, ownsEscape = () => false, onOutsideClick, onEscape }) {
  let isPressedOnMask = false
  const isMask = (element) => !!element?.classList?.contains(maskClass)

  function onPointerDown(event) {
    isPressedOnMask = isOpen() && isMask(event.target)
  }

  function onPointerUp(event) {
    const isClick = isPressedOnMask && isMask(event.target)
    isPressedOnMask = false
    if (isClick && isOpen()) setTimeout(onOutsideClick)
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape' || event.isComposing || !isOpen() || ownsEscape()) return
    // The popup or dialog above closes itself.
    if (isNestedPopupOpen(maskClass, event.target?.ownerDocument ?? document)) return
    // A text field is left first, e.g. a search box.
    if (event.target?.matches?.(TEXT_FIELD_SELECTOR)) {
      event.target.blur()
      return
    }
    // Once this key is done with: a dialog opened while it is still dispatched, e.g. to ask about unsaved edits,
    // would hear it too, and close.
    setTimeout(onEscape)
  }

  onMounted(() => {
    // Captured, so the editor hears a popup still open before the popup's own Escape closes it.
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('keydown', onKeyDown, true)
  })
  onUnmounted(() => {
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('pointerup', onPointerUp, true)
    document.removeEventListener('keydown', onKeyDown, true)
  })

  return { onPointerDown, onPointerUp, onKeyDown }
}
