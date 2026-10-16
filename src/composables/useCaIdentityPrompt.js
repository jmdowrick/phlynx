/**
 * Asks for super-modules' circulatory_autogen identities, one at a time, before a native CA export writes them (see
 * services/export/caNative.js). CaIdentityDialog shows the question; cancelling it leaves the super-module without one,
 * so the export writes it flat.
 */
import { shallowRef } from 'vue'

// One prompt for the app, shared by every caller.
const question = shallowRef(null)
let respond = null

/**
 * Gives the identity prompt.
 *
 * @returns {{question: import('vue').ShallowRef<Object|null>, ask: Function, answer: Function}}
 */
export function useCaIdentityPrompt() {
  /**
   * Asks for one super-module's identity.
   *
   * @param {Object} request - From caIdentityRequests: `{smId, name, reason, from?, suggestion}`.
   * @param {(identity: Object) => string|null} problemOf - Why an identity can't be its, or null.
   * @returns {Promise<{module_type: string, module_subtype: string}|null>} Null when cancelled.
   */
  function ask(request, problemOf) {
    respond?.(null)
    return new Promise((resolve) => {
      respond = resolve
      question.value = { ...request, problemOf }
    })
  }

  /**
   * Answers the question asked.
   *
   * @param {{module_type: string, module_subtype: string}|null} identity - Null to cancel.
   */
  function answer(identity) {
    const resolve = respond
    respond = null
    question.value = null
    resolve?.(identity)
  }

  return { question, ask, answer }
}
