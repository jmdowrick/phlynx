/**
 * The formats a module's math can be authored in. A math is CellML unless the library holds a
 * source for it (libraryStore.mathSources), whose `format` is one of these ids.
 *
 * Each format gives:
 * - `label`, `icon` and `svgPath`: the node badge, and its stroked path in a 14 x 14 box for the
 *   SVG export;
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
    icon: 'pi-code',
    svgPath: 'M4.6 3.8 1.4 7l3.2 3.2 M9.4 3.8 12.6 7 9.4 10.2 M8 2.6 6 11.4',
    isMathLocked: false,
    caModuleFormat: 'cellml',
    isAvailable: true,
  }),
  celldl: Object.freeze({
    id: 'celldl',
    label: 'CellDL',
    icon: 'pi-sitemap',
    svgPath: 'M5.4 1.4h3.2v2.8H5.4Z M7 4.2v2.4 M3 6.6h8 M3 6.6v2.2 M11 6.6v2.2 M1.4 8.8h3.2v2.8H1.4Z M9.4 8.8h3.2v2.8H9.4Z',
    isMathLocked: true,
    // The CA export writes the generated CellML, never the diagram.
    caModuleFormat: 'cellml',
    // Off until PhLynx bundles the CellDL editor and converter.
    isAvailable: false,
  }),
})

/** Icon and path for a format this build doesn't know, e.g. from a newer PhLynx. */
const UNKNOWN_FORMAT_ICON = 'pi-question-circle'
const UNKNOWN_FORMAT_SVG_PATH =
  'M7 1.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 1 0 7 1.4Z M5.3 5.4a1.8 1.8 0 1 1 2.5 1.6c-.5.3-.8.6-.8 1.2 M7 10.2v.1'

/** Every format icon's SVG path, for the SVG export. */
export const MODULE_FORMAT_SVG_ICONS = Object.freeze({
  ...Object.fromEntries(Object.values(MODULE_FORMATS).map((format) => [format.icon, format.svgPath])),
  [UNKNOWN_FORMAT_ICON]: UNKNOWN_FORMAT_SVG_PATH,
})

/**
 * Gets a format by id. A missing id is CellML; an unknown one gets a locked, unavailable fallback,
 * so its generated CellML stays read-only.
 *
 * @param {string|null|undefined} id
 * @returns {{ id: string, label: string, icon: string, svgPath: string, isMathLocked: boolean, caModuleFormat: string, isAvailable: boolean }}
 */
export function getModuleFormat(id) {
  if (!id) return MODULE_FORMATS[DEFAULT_MODULE_FORMAT]
  if (Object.hasOwn(MODULE_FORMATS, id)) return MODULE_FORMATS[id]
  return Object.freeze({
    id,
    label: id,
    icon: UNKNOWN_FORMAT_ICON,
    svgPath: UNKNOWN_FORMAT_SVG_PATH,
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
