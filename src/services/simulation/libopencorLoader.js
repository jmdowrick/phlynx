/**
 * Loads libOpenCOR, the simulator, in the background. Its WebAssembly build needs SharedArrayBuffer, so
 * it loads only in a cross-origin isolated page (see utils/isolation.js).
 */
import { markRaw, reactive } from 'vue'

import { getIsolationStatus } from '../../utils/isolation'

// Defined by scripts/libopencorAssets.js; builds without it (Electron) have no simulator.
const LIBOPENCOR_BASE = typeof __LIBOPENCOR_BASE__ === 'undefined' ? null : __LIBOPENCOR_BASE__

/**
 * The simulator's state: `status` is 'idle', 'loading', 'ready', 'unavailable' (it can't load here, with
 * `reason` saying why) or 'error' (it failed to load, with `reason` giving the error).
 */
export const libopencor = reactive({ status: 'idle', reason: null, versionString: null })

let loading = null

/**
 * Starts loading libOpenCOR, once; later calls return the same promise.
 *
 * @param {Object} [options]
 * @param {Object} [options.scope=globalThis] - The window to check for isolation.
 * @param {Function} [options.importModule] - Imports the glue module from a URL.
 * @returns {Promise<Object|null>} The libOpenCOR module, or null when it can't or didn't load.
 */
export function loadLibOpenCOR({ scope = globalThis, importModule = (url) => import(/* @vite-ignore */ url) } = {}) {
  if (loading) return loading

  const isolation = getIsolationStatus(scope)
  const reason = !LIBOPENCOR_BASE ? 'The simulator isn’t part of this build.' : isolation.reason
  if (reason) {
    Object.assign(libopencor, { status: 'unavailable', reason })
    loading = Promise.resolve(null)
    return loading
  }

  libopencor.status = 'loading'
  loading = importModule(`${LIBOPENCOR_BASE}libopencor.js`)
    .then(({ default: createModule }) => createModule({ locateFile: (file) => `${LIBOPENCOR_BASE}${file}` }))
    .then((module) => {
      Object.assign(libopencor, { status: 'ready', reason: null, versionString: module.versionString() })
      return markRaw(module)
    })
    .catch((error) => {
      Object.assign(libopencor, { status: 'error', reason: error?.message ?? String(error) })
      return null
    })
  return loading
}

/**
 * Waits for libOpenCOR, starting it if nothing has.
 *
 * @returns {Promise<Object|null>} The libOpenCOR module, or null when it can't or didn't load.
 */
export function whenLibOpenCORReady() {
  return loading ?? loadLibOpenCOR()
}

/** Forgets the load, so the next call starts again. For tests. */
export function resetLibOpenCORLoader() {
  loading = null
  Object.assign(libopencor, { status: 'idle', reason: null, versionString: null })
}
