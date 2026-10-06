/**
 * Runs libOpenCOR off the main thread. Reading a large model alone takes seconds, which would freeze the
 * page. Messages: `load` → `ready`/`failed`; `run` → `progress`… then `done`/`error`; `stop`.
 */
import { startSimulation } from '../services/simulation/engine'

let module = null
const runs = new Map()

/**
 * Loads libOpenCOR from where the build serves it.
 *
 * @param {string} base - The URL of its folder.
 */
async function load(base) {
  try {
    const { default: createModule } = await import(/* @vite-ignore */ `${base}libopencor.js`)
    module = await createModule({ locateFile: (file) => `${base}${file}` })
    self.postMessage({ type: 'ready', versionString: module.versionString() })
  } catch (error) {
    self.postMessage({ type: 'failed', message: error?.message ?? String(error) })
  }
}

/**
 * Runs a simulation and posts its results, handing their arrays over rather than copying them.
 *
 * @param {Object} message - `{ id, cellml, settings }`.
 */
async function run({ id, cellml, settings }) {
  const simulation = startSimulation({
    module,
    cellml,
    settings,
    onProgress: (value) => self.postMessage({ type: 'progress', id, value }),
  })
  runs.set(id, simulation)
  try {
    const results = await simulation.promise
    const variables = [...results.variables]
    const buffers = [results.voi.values.buffer, ...variables.map(([, series]) => series.values.buffer)]
    self.postMessage({ type: 'done', id, results: { ...results, variables } }, buffers)
  } catch (error) {
    const partial = error.partialResults
    const variables = partial ? [...partial.variables] : []
    const buffers = partial ? [partial.voi.values.buffer, ...variables.map(([, series]) => series.values.buffer)] : []
    const partialResults = partial ? { ...partial, variables } : null
    self.postMessage({ type: 'error', id, message: error.message, issues: error.issues ?? [], partialResults }, buffers)
  } finally {
    runs.delete(id)
  }
}

self.onmessage = ({ data }) => {
  if (data.type === 'load') load(data.base)
  else if (data.type === 'run') run(data)
  else if (data.type === 'stop') runs.get(data.id)?.stop()
}
