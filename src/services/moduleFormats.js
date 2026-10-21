/**
 * The formats a module's math can be authored in. A math is CellML unless the library holds a
 * source for it (libraryStore.mathSources), whose `format` is one of these ids.
 *
 * Each format gives:
 * - `label`: its name, as messages show it;
 * - `isMathLocked`: whether the CellML is generated from the source, so must not be edited;
 * - `caModuleFormat`: the CA config's `module_format`;
 * - `isAvailable`: whether this build can open the format;
 * - `editorTab` (optional): the instance editor tab that edits the source, `{ value, label, icon, errorHeader }`,
 *   shown beside the CellML Text and Math Editor tabs.
 */

export const DEFAULT_MODULE_FORMAT = 'cellml'

export const MODULE_FORMATS = Object.freeze({
  cellml: Object.freeze({
    id: 'cellml',
    label: 'CellML',
    isMathLocked: false,
    caModuleFormat: 'cellml',
    isAvailable: true,
  }),
  celldl: Object.freeze({
    id: 'celldl',
    label: 'CellDL',
    isMathLocked: true,
    // The CA export writes the generated CellML, never the diagram.
    caModuleFormat: 'cellml',
    // Off until PhLynx bundles the CellDL editor and converter.
    isAvailable: false,
  }),
})

/**
 * Gets a format by id. A missing id is CellML; an unknown one gets a locked, unavailable fallback,
 * so its generated CellML stays read-only.
 *
 * @param {string|null|undefined} id
 * @returns {{ id: string, label: string, isMathLocked: boolean, caModuleFormat: string, isAvailable: boolean, editorTab?: Object }}
 */
export function getModuleFormat(id) {
  if (!id) return MODULE_FORMATS[DEFAULT_MODULE_FORMAT]
  if (Object.hasOwn(MODULE_FORMATS, id)) return MODULE_FORMATS[id]
  return Object.freeze({
    id,
    label: id,
    isMathLocked: true,
    caModuleFormat: 'cellml',
    isAvailable: false,
  })
}

/**
 * Checks a math source read from a file or the clipboard. Its format must be named, and its
 * document and document URI must be text (the document may be null for a new, empty diagram).
 * Other fields are kept as they are, so a newer format's source survives a round trip.
 *
 * @param {*} source
 * @returns {Object|null} The source, or null if it is malformed.
 */
export function checkMathSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null
  if (typeof source.format !== 'string' || !source.format) return null
  if (source.document !== null && typeof source.document !== 'string') return null
  if (typeof source.documentUri !== 'string') return null
  return source
}
