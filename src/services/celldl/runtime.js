/**
 * The CellDL converter: bg2cellml with PhLynx's libCellML and the CellDL editor's oxigraph and
 * BG-RDF framework, so PhLynx ships one oxigraph. Both packages are imported only dynamically, so
 * they load when a CellDL module first needs converting.
 * bg2cellml's oxigraph peer dependency is left unmet on purpose: it never imports oxigraph, and
 * only uses the module it is given.
 */
import { whenLibCellMLReady } from '../../utils/cellml.js'

let converterPromise = null

/**
 * Starts the editor's RDF layer, which loads its oxigraph and the BG-RDF framework.
 *
 * The editor doesn't export its initialiser yet, so this runs its async component's loader, which
 * initialises the RDF layer and then loads the editor's UI chunk. Outside a browser that chunk
 * fails to load after the RDF layer is up, which is fine here.
 *
 * @param {Object} editor - The `@celldl/editor` module.
 * @returns {Promise<Object>} The editor's oxigraph module.
 */
async function initialiseEditorRdf(editor) {
  try {
    await editor.CellDLEditor.__asyncLoader()
  } catch (error) {
    if (!globalThis.rdfModule) throw error
  }
  if (!globalThis.rdfModule) throw new Error("The CellDL editor's RDF layer didn't start")
  return globalThis.rdfModule
}

/**
 * Creates a converter with the BG-RDF framework loaded.
 *
 * @returns {Promise<Object>} A bg2cellml Converter.
 */
async function createConverter() {
  const [libcellml, editor, { Converter }] = await Promise.all([
    whenLibCellMLReady(),
    import('@celldl/editor'),
    import('@physiomelinks/bg2cellml'),
  ])
  const oxigraph = await initialiseEditorRdf(editor)
  const converter = new Converter({ libcellml, oxigraph })
  const issues = converter.loadFramework({ quads: editor.bgRdfStatements() })
  if (issues.length) throw new Error(`The BG-RDF framework didn't load: ${issues.join('; ')}`)
  return converter
}

/**
 * Gets the shared converter, creating it on first use. A failure isn't kept, so the next call
 * tries again.
 *
 * @returns {Promise<Object>} A bg2cellml Converter.
 */
export function getConverter() {
  converterPromise ??= createConverter().catch((error) => {
    converterPromise = null
    throw error
  })
  return converterPromise
}
