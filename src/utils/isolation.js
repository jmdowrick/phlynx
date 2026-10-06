/**
 * Cross-origin isolation, which the simulator needs for SharedArrayBuffer. public/coi-serviceworker.js
 * provides it; where it can't, these say why.
 */

/**
 * Gets whether the page is cross-origin isolated, and if not, why.
 *
 * @param {Object} [scope=globalThis] - The window to check.
 * @returns {{isIsolated: boolean, reason: string|null}}
 */
export function getIsolationStatus(scope = globalThis) {
  if (scope.crossOriginIsolated === true) return { isIsolated: true, reason: null }
  if (!scope.isSecureContext) {
    return { isIsolated: false, reason: 'The simulator needs a secure (https) connection.' }
  }
  if (!scope.navigator?.serviceWorker) {
    return {
      isIsolated: false,
      reason: 'This browser window doesn’t allow service workers (a private window, for example), which the simulator needs.',
    }
  }
  return { isIsolated: false, reason: 'The simulator isn’t ready yet. Reload the page to finish setting it up.' }
}
