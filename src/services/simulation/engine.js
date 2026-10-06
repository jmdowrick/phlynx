/**
 * Runs a CellML model through libOpenCOR. The only module that touches libOpenCOR's API; the rest of the
 * app gets plain results.
 */
import { CVODE_PARAMETERS, buildUniformTimeCourse } from './sedParameters'

// Above this, a run's results risk exhausting WebAssembly's 4 GB of memory.
export const MAX_RESULT_BYTES = 1.5 * 1024 ** 3

const POLL_INTERVAL_MS = 50
const RUNNING = 1

// libOpenCOR's enum member for each SED-ML value of the CVODE settings that are enums.
const CVODE_ENUMS = {
  integrationMethod: { type: 'IntegrationMethod', values: { BDF: 'BDF', Adams: 'ADAMS_MOULTON' } },
  iterationType: { type: 'IterationType', values: { Newton: 'NEWTON', Functional: 'FUNCTIONAL' } },
  linearSolver: { type: 'LinearSolver', values: { Dense: 'DENSE', Banded: 'BANDED', Diagonal: 'DIAGONAL', GMRES: 'GMRES', BiCGStab: 'BICGSTAB', TFQMR: 'TFQMR' } },
  preconditioner: { type: 'Preconditioner', values: { Banded: 'BANDED', None: 'NO' } },
}

// The kinds of variable a task reports, with the names of libOpenCOR's accessors for each.
const VARIABLE_KINDS = [
  { kind: 'state', count: 'stateCount', name: 'stateName', unit: 'stateUnit', values: 'state' },
  { kind: 'rate', count: 'rateCount', name: 'rateName', unit: 'rateUnit', values: 'rate' },
  { kind: 'constant', count: 'constantCount', name: 'constantName', unit: 'constantUnit', values: 'constant' },
  { kind: 'computedConstant', count: 'computedConstantCount', name: 'computedConstantName', unit: 'computedConstantUnit', values: 'computedConstant' },
  { kind: 'algebraic', count: 'algebraicVariableCount', name: 'algebraicVariableName', unit: 'algebraicVariableUnit', values: 'algebraicVariable' },
]

let fileCount = 0

/** A failed simulation, with libOpenCOR's issues when it gave any. */
export class SimulationError extends Error {
  /**
   * @param {string} message
   * @param {Array<{type: string, description: string}>} [issues]
   */
  constructor(message, issues = []) {
    super(message)
    this.name = 'SimulationError'
    this.issues = issues
  }
}

/**
 * Lists a libOpenCOR logger's issues as plain objects.
 *
 * @param {Object} logger - A File, SedDocument or SedInstance.
 * @returns {Array<{type: string, description: string}>}
 */
function readIssues(logger) {
  return Array.from({ length: logger.issueCount }, (_, i) => {
    const issue = logger.issue(i)
    const plain = { type: issue.typeAsString, description: issue.description }
    issue.delete()
    return plain
  })
}

/**
 * Throws when a logger has errors.
 *
 * @param {Object} logger
 * @param {string} message
 */
function throwOnErrors(logger, message) {
  if (logger.hasErrors) throw new SimulationError(message, readIssues(logger))
}

/**
 * Applies the shared CVODE settings to a simulation's solver.
 *
 * @param {Object} loc - The libOpenCOR module.
 * @param {Object} solver - The simulation's ODE solver.
 */
function applyCvodeParameters(loc, solver) {
  if (solver?.constructor?.name !== 'SolverCvode') return
  for (const { name, value } of CVODE_PARAMETERS) {
    const enumeration = CVODE_ENUMS[name]
    if (enumeration) solver[name] = loc.SolverCvode[enumeration.type][enumeration.values[value]]
    else if (value === 'true' || value === 'false') solver[name] = value === 'true'
    else solver[name] = Number(value)
  }
}

/**
 * Counts the points a run computed. A stopped run leaves the rest of its arrays unfilled, so its VOI leaves
 * the time course's grid of output times there.
 *
 * @param {Float64Array} voi
 * @param {{outputStartTime: number, outputEndTime: number, numberOfSteps: number}} timeCourse
 * @returns {number}
 */
export function countComputedPoints(voi, { outputStartTime, outputEndTime, numberOfSteps }) {
  const interval = numberOfSteps > 0 ? (outputEndTime - outputStartTime) / numberOfSteps : 0
  const tolerance = 1e-9 * Math.max(Math.abs(outputStartTime), Math.abs(outputEndTime), 1)
  let count = 0
  while (count < voi.length && Math.abs(voi[count] - (outputStartTime + count * interval)) <= tolerance) count++
  return count
}

/**
 * Copies a task's results out of WebAssembly memory, which the run's objects share.
 *
 * @param {Object} task - A SedInstanceTask.
 * @param {Object|null} stoppedTimeCourse - The time course of a stopped run, whose computed points alone are kept.
 * @param {number} [pointCount] - How many points to keep, when already known.
 * @returns {{voi: {name: string, unit: string, values: Float64Array}, variables: Map<string, Object>}}
 */
function readResults(task, stoppedTimeCourse, pointCount) {
  const voi = task.voi
  const length = pointCount ?? (stoppedTimeCourse ? countComputedPoints(voi, stoppedTimeCourse) : voi.length)
  const copy = (values) => Float64Array.from(values.subarray(0, length))
  const variables = new Map()
  for (const { kind, count, name, unit, values } of VARIABLE_KINDS) {
    for (let i = 0; i < task[count]; i++) {
      variables.set(task[name](i), { kind, unit: task[unit](i), values: copy(task[values](i)) })
    }
  }
  return { voi: { name: task.voiName, unit: task.voiUnit, values: copy(voi) }, variables }
}

/**
 * Throws unless the settings describe a time course to run: numbers throughout, an end after the start, a
 * positive point interval, and an initial time no later than the start.
 *
 * @param {Object} settings - Simulation settings.
 */
export function checkSettings({ initialPoint, startingPoint, endingPoint, pointInterval }) {
  const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)
  if (![initialPoint, startingPoint, endingPoint, pointInterval].every(isNumber)) {
    throw new SimulationError('Every time in the simulation settings needs a value.')
  }
  if (endingPoint <= startingPoint) throw new SimulationError('The simulation settings need an end after the start.')
  if (pointInterval <= 0) throw new SimulationError('The simulation settings need a point interval above 0.')
  if (pointInterval > endingPoint - startingPoint) {
    throw new SimulationError('The point interval is longer than the time between the start and the end.')
  }
  if (initialPoint > startingPoint) throw new SimulationError('The initial time can’t be after the start.')
}

/**
 * Estimates the memory a run's results take: every variable and the VOI, at every output point.
 *
 * @param {Object} task - A SedInstanceTask.
 * @param {number} numberOfSteps
 * @returns {number} Bytes.
 */
export function estimateResultBytes(task, numberOfSteps) {
  const variableCount = 1 + VARIABLE_KINDS.reduce((total, { count }) => total + task[count], 0)
  return variableCount * (numberOfSteps + 1) * Float64Array.BYTES_PER_ELEMENT
}

/**
 * Starts simulating a CellML model with the given settings. libOpenCOR runs it on its own threads; this
 * polls its progress until it finishes.
 *
 * @param {Object} options
 * @param {Object} options.module - The libOpenCOR module (see libopencorLoader.js).
 * @param {string} options.cellml - The flattened CellML model.
 * @param {Object} options.settings - Simulation settings (simulationSettingsStore.simulationSettings).
 * @param {Function} [options.onProgress] - Called with the progress, from 0 to 1.
 * @returns {{promise: Promise<Object>, stop: Function}} `promise` resolves with `{ voi, variables, issues,
 *   elapsedMs, isStopped }` or rejects with a SimulationError; `stop` ends the run early, keeping what it has.
 */
export function startSimulation({ module: loc, cellml, settings, onProgress = () => {} }) {
  let instance = null
  let isStopped = false

  const promise = (async () => {
    // Start after returning, so the caller has `stop` before the first progress report.
    await Promise.resolve()
    const file = new loc.File(`phlynx-simulation-${++fileCount}.cellml`)
    // Every handle libOpenCOR gives back, freed once the run ends.
    const handles = []
    const keep = (handle) => (handle && handles.push(handle), handle)
    let document = null
    try {
      file.setContents(new TextEncoder().encode(cellml))
      throwOnErrors(file, 'The model could not be read.')

      document = new loc.SedDocument(file)
      throwOnErrors(document, 'The model could not be simulated.')

      checkSettings(settings)
      const timeCourse = buildUniformTimeCourse(settings)
      const simulation = keep(document.simulation(0))
      Object.assign(simulation, timeCourse)
      applyCvodeParameters(loc, keep(simulation.odeSolver))

      instance = document.instantiate()
      throwOnErrors(instance, 'The model could not be simulated.')

      const task = keep(instance.task(0))
      if (!task?.voiName) {
        throw new SimulationError('The model has no differential equation, so there is nothing to simulate over time.')
      }
      const bytes = estimateResultBytes(task, timeCourse.numberOfSteps)
      if (bytes > MAX_RESULT_BYTES) {
        const gigabytes = (bytes / 1024 ** 3).toFixed(1)
        throw new SimulationError(`The results would need ${gigabytes} GB of memory. Use fewer points (a larger point interval).`)
      }

      if (isStopped) return { ...readResults(task, timeCourse, 0), issues: [], elapsedMs: 0, isStopped }
      if (!instance.startRun()) throw new SimulationError('The simulation could not start.', readIssues(instance))
      while (instance.status.value === RUNNING) {
        onProgress(instance.progress)
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      }
      const elapsedMs = instance.waitForRun()
      throwOnErrors(instance, 'The simulation failed.')
      onProgress(1)

      return { ...readResults(task, isStopped ? timeCourse : null), issues: readIssues(instance), elapsedMs, isStopped }
    } finally {
      // A run still going (a throwing onProgress, say) is stopped first: freeing it mid-run blocks the page.
      if (instance?.status.value === RUNNING) {
        instance.stopRun()
        instance.waitForRun()
      }
      handles.reverse().forEach((handle) => handle.delete())
      instance?.delete()
      instance = null
      document?.delete()
      const fileManager = loc.FileManager.instance()
      fileManager.unmanage(file)
      fileManager.delete()
      file.delete()
    }
  })()

  return {
    promise,
    stop: () => {
      isStopped = true
      instance?.stopRun()
    },
  }
}
