/**
 * Asks for the values the instance folders of the CellML export with imports need to run on their own (see
 * services/export/cellmlHierarchical.js standaloneInputs), before it asks where to save. StandaloneInputsDialog shows
 * the question; cancelling it cancels the export. The values are never saved: each export asks again.
 */
import { shallowRef } from 'vue'

// One prompt for the app, shared by every caller.
const question = shallowRef(null)
let respond = null

/**
 * Gives the standalone inputs prompt.
 *
 * @returns {{question: import('vue').ShallowRef<Object|null>, ask: Function, answer: Function}}
 */
export function useStandaloneInputsPrompt() {
  /**
   * Asks for the inputs' values.
   *
   * @param {Object[]} folders - From standaloneInputs: `{folder, name, kind, path, inputs}`.
   * @param {Map<string, string>} values - Each input's prefilled value, by input id (prefillStandaloneInputs).
   * @returns {Promise<Map<string, string>|null>} The values given, by input id; null when cancelled.
   */
  function ask(folders, values) {
    respond?.(null)
    return new Promise((resolve) => {
      respond = resolve
      question.value = { folders, values }
    })
  }

  /**
   * Answers the question asked.
   *
   * @param {Map<string, string>|null} values - Null to cancel.
   */
  function answer(values) {
    const resolve = respond
    respond = null
    question.value = null
    resolve?.(values)
  }

  return { question, ask, answer }
}
