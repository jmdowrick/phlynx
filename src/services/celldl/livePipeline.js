/**
 * SPIKE: bg2cellml's convert(), split into timed stages, with a cheap pass that skips libCellML's
 * Validator and Analyser. Shared by the worker and the main-thread comparison so both run the same code.
 */
import {
  BondgraphModel,
  IssueLog,
  buildCellMLModel,
  checkCellMLModel,
  elementManifest,
  freeBuild,
} from '@physiomelinks/bg2cellml'

const now = () => performance.now()

/**
 * Converts BG-RDF Turtle.
 *
 * @param {{ libcellml: Object, oxigraph: Object, domParser?: Object }} runtime
 * @param {Object} framework - A loaded BondgraphFramework.
 * @param {string} rdf - The diagram's BG-RDF Turtle.
 * @param {{ baseUri: string, componentName: string, knownUnits?: string[], cheap?: boolean, withCellml?: boolean }} options
 * @returns {{ ok: boolean, modelType?: string, issues: Object[], elements: Object, cellml?: string, timings: Object }}
 */
export function convertLive(runtime, framework, rdf, { baseUri, componentName, knownUnits, cheap = false, validateOnly = false, withCellml = true }) {
  const timings = {}
  const t0 = now()
  const issues = []
  let model
  try {
    model = BondgraphModel.fromTurtle(framework, runtime, rdf, baseUri)
  } catch (error) {
    return { ok: false, issues: [{ message: String(error?.message ?? error), severity: 'error', stage: 'rdf' }], elements: {}, timings: { total: now() - t0 } }
  }
  timings.model = now() - t0
  issues.push(...model.log.issues)
  if (issues.some((issue) => issue.severity === 'error')) {
    timings.total = now() - t0
    return { ok: false, issues, elements: {}, timings }
  }
  const log = new IssueLog('build', model.iri || undefined)
  const t1 = now()
  const build = buildCellMLModel(runtime.libcellml, model, log, {
    componentName,
    ...(knownUnits?.length ? { knownUnits } : {}),
  })
  timings.build = now() - t1
  try {
    const elements = elementManifest(build, model)
    let modelType
    if (validateOnly && !log.issues.some((issue) => issue.severity === 'error')) {
      // SPIKE: the Validator alone, to split the check's cost.
      const t2 = now()
      const validator = new runtime.libcellml.Validator()
      try {
        validator.validateModel(build.model)
        for (let index = 0; index < validator.issueCount(); index += 1) {
          const issue = validator.issue(index)
          issues.push({ message: `CellML validation: ${issue.description()}`, severity: 'error', stage: 'validator' })
          issue.delete?.()
        }
      } finally {
        validator.delete?.()
      }
      timings.check = now() - t2
    } else if (!cheap && !log.issues.some((issue) => issue.severity === 'error')) {
      const t2 = now()
      modelType = checkCellMLModel(runtime.libcellml, build.model, log).type
      timings.check = now() - t2
    }
    let cellml
    if (withCellml) {
      const t3 = now()
      const printer = new runtime.libcellml.Printer()
      try {
        cellml = printer.printModel(build.model, false)
      } finally {
        printer.delete?.()
      }
      timings.print = now() - t3
    }
    issues.push(...log.issues)
    timings.total = now() - t0
    return { ok: !issues.some((issue) => issue.severity === 'error'), modelType, issues, elements, cellml, timings }
  } finally {
    freeBuild(build)
  }
}
