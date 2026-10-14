import { hasInjectionContext, inject, provide } from 'vue'
import { useFlowHistoryStore } from '../stores/historyStore'

const FLOW_HISTORY_KEY = Symbol('flowHistory')

/**
 * Makes `history` the undo stack its descendants record into. Vue injects from the parent, so
 * composables the providing component calls itself must be given `history` directly.
 *
 * @param {Object} history - The workspace store or a createHistory() stack.
 * @returns {Object} `history`.
 */
export function provideFlowHistory(history) {
  provide(FLOW_HISTORY_KEY, history)
  return history
}

/**
 * Picks the undo stack to record into: `own` if given, else the nearest provided one, else the
 * workspace store. Call it during setup; elsewhere nothing is injected.
 *
 * @param {Object|null} [own]
 * @returns {Object}
 */
export function useFlowHistoryFor(own = null) {
  if (own) return own
  return (hasInjectionContext() && inject(FLOW_HISTORY_KEY, null)) || useFlowHistoryStore()
}
