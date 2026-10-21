/**
 * Gets the units the library already has, for bg2cellml to name its own units around: every
 * units file but the module's own, which the conversion replaces.
 *
 * @param {Array<{ componentFile: string, model: string }>} availableUnits - libraryStore.availableUnits.
 * @param {string} [ownUnitsFile] - The module's units file.
 * @returns {string[]} Each file's CellML.
 */
export function knownUnitsFor(availableUnits, ownUnitsFile) {
  return (availableUnits ?? []).filter((file) => file.componentFile !== ownUnitsFile).map((file) => file.model)
}
