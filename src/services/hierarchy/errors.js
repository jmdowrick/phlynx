/**
 * The problems expanding subsystems finds (expandHierarchy's `errors`), as the builds that read the model report them:
 * an error stops a simulation or export, a warning is shown with it.
 */

/**
 * Keeps the problems that concern some modules: those naming one of them, and those naming none, which concern every
 * build.
 *
 * @param {Array<{ids?: string[]}>} errors - From expandHierarchy.
 * @param {Iterable<string>} ids - The model ids built.
 * @returns {Array}
 */
export function errorsConcerning(errors, ids) {
  const built = new Set(ids)
  return errors.filter((error) => !error.ids?.length || error.ids.some((id) => built.has(id)))
}

/**
 * Words problems as a build's errors and warnings, each message once.
 *
 * @param {Array<{severity: string, message: string}>} errors - From expandHierarchy.
 * @returns {{errors: string[], warnings: string[]}}
 */
export function summariseExpansionErrors(errors) {
  const messagesOf = (list) => [...new Set(list.map((error) => error.message))]
  return {
    errors: messagesOf(errors.filter((error) => error.severity === 'error')),
    warnings: messagesOf(errors.filter((error) => error.severity !== 'error')),
  }
}
