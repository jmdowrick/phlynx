/**
 * Adds a CellDL diagram to the library as a module, with the diagram as its math's source. Load it
 * with import(), as it brings in the converter.
 */
import { parseMathRef, parseModuleRef } from '../../utils/config.js'
import { cleanName, getUniqueName } from '../../utils/identifiers.js'
import { convertCelldl, knownUnitsFor } from './convert.js'
import { mintDocumentUri } from './documentUri.js'
import { undrawnElements, undrawnError } from './drawing.js'

/**
 * Names a diagram's component and CellML file after its file name, avoiding every component,
 * module type and file the library already has.
 *
 * @param {string} filename - e.g. `my rc.celldl`.
 * @param {Object} libraryStore
 * @returns {{ componentName: string, cellmlFile: string, mathRef: string }} e.g. `my_rc`,
 *   `my_rc.cellml` and `my_rc.cellml:my_rc`.
 */
export function celldlImportNames(filename, libraryStore) {
  const stem = String(filename ?? '').replace(/\.celldl$/i, '')
  const taken = new Set()
  for (const mathRef of libraryStore.availableMath.keys()) {
    const { componentFile, componentName } = parseMathRef(mathRef)
    taken.add(componentName).add(componentFile?.replace(/\.cellml$/i, ''))
  }
  for (const moduleRef of libraryStore.availableModules.keys()) taken.add(parseModuleRef(moduleRef).moduleType)
  for (const file of libraryStore.availableUnits) taken.add(file.componentFile.replace(/\.cellml$/i, ''))

  const componentName = getUniqueName(cleanName(stem) || 'celldl', taken)
  const cellmlFile = `${componentName}.cellml`
  return { componentName, cellmlFile, mathRef: `${cellmlFile}:${componentName}` }
}

/**
 * Converts a CellDL diagram and adds it to the library: its source, then its math (which creates
 * its module), then its units. Nothing is added if it doesn't convert, the CellDL editor couldn't
 * open it, or its warnings aren't accepted.
 *
 * @param {string} filename
 * @param {string} document - The CellDL SVG.
 * @param {Object} libraryStore
 * @param {Object} [options]
 * @param {(warnings: Object[]) => Promise<boolean>} [options.confirmWarnings] - Asks whether to add a
 *   diagram that converts with warnings; without it, such a diagram is added.
 * @returns {Promise<{ ok: boolean, cancelled?: boolean, mathRef: string, componentName: string,
 *   errors: Object[], warnings: Object[] }>} Issues are bg2cellml's. Rejects if the converter can't start.
 */
export async function importCelldl(filename, document, libraryStore, { confirmWarnings } = {}) {
  const { componentName, cellmlFile, mathRef } = celldlImportNames(filename, libraryStore)
  const result = await convertCelldl(document, {
    documentUri: mintDocumentUri(mathRef),
    componentName,
    knownUnits: knownUnitsFor(libraryStore.availableUnits, cellmlFile),
  })
  const outcome = { ok: false, mathRef, componentName, errors: result.errors, warnings: result.warnings }
  if (!result.ok) return outcome
  // Only the named component becomes the module, so a source is never stored without its math.
  const components = result.components.filter((component) => component.name === componentName)
  if (!components.length) {
    const message = `The diagram's CellML has no component named ${componentName}`
    return { ...outcome, errors: [{ message, severity: 'error', stage: 'build' }] }
  }
  // Its CellDL tab would fail to open a diagram that converts but doesn't draw its elements.
  const undrawn = undrawnElements(document, Object.keys(result.elements ?? {}))
  if (undrawn.length) return { ...outcome, errors: [undrawnError(undrawn)] }
  if (result.warnings.length && confirmWarnings && !(await confirmWarnings(result.warnings))) {
    return { ...outcome, cancelled: true }
  }

  libraryStore.setMathSource(mathRef, {
    format: 'celldl',
    document,
    documentUri: result.documentUri,
    elements: result.elements,
    generator: result.generator,
    frameworkVersion: result.frameworkVersion,
  })
  libraryStore.addMathFile(cellmlFile, components)
  if (result.unitsModel) libraryStore.addUnitsFile({ componentFile: cellmlFile, model: result.unitsModel })
  return { ...outcome, ok: true }
}
