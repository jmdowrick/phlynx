/**
 * Every variable in the workspace as an `instance/variable` path, for one search box across the whole model,
 * as web OpenCOR lists `component/variable`. Each entry says whether it can be plotted or given a slider.
 */
import { isPlottableRow } from './plotSelections'
import { isSlidableRow } from './parameterSliders'
import { mappingKey } from './variableMapping'

// The component global constants are flattened into, which names them in a path.
export const GLOBAL_COMPONENT = 'global_parameters'

/**
 * Builds the index. A global constant is listed once, under GLOBAL_COMPONENT, however many instances use it.
 * Given a run's mapping, each entry also names the variables that are the same as it in the model.
 *
 * @param {Array<Object>} nodes - Workspace nodes.
 * @param {Object} [options]
 * @param {string[]|null} [options.scopeNodeIds] - The nodes the last run simulated, or null for all of them.
 * @param {Map<string, string>|null} [options.mapping] - `nodeId::name` to the name libOpenCOR reports.
 * @returns {Array<{key: string, path: string, component: string, name: string, nodeId: string, rowName: string,
 *   kind: string, units: string, plottable: boolean, slidable: boolean, inScope: boolean, reportedName: string|null,
 *   equivalents: string[]}>}
 */
export function buildVariableIndex(nodes, { scopeNodeIds = null, mapping = null } = {}) {
  const inScope = (nodeId) => !scopeNodeIds || scopeNodeIds.includes(nodeId)
  const entries = []
  const globals = new Map()

  for (const node of nodes ?? []) {
    const component = node?.data?.name
    if (!component) continue
    for (const row of node.data.variables ?? []) {
      if (!row?.name) continue
      const key = mappingKey(node.id, row.name)
      if (row.type === 'global_constant') {
        // Listed once; the first instance using it stands for it, as a slider needs one.
        const existing = globals.get(row.name)
        if (existing) existing.inScope ||= inScope(node.id)
        else {
          globals.set(row.name, {
            key: `global::${row.name}`,
            path: `${GLOBAL_COMPONENT}/${row.name}`,
            component: GLOBAL_COMPONENT,
            name: row.name,
            nodeId: node.id,
            rowName: row.name,
            kind: row.type,
            units: row.units || '',
            plottable: false,
            slidable: isSlidableRow(row),
            inScope: inScope(node.id),
            reportedName: mapping?.get(key) ?? null,
            equivalents: [],
          })
        }
        continue
      }
      entries.push({
        key,
        path: `${component}/${row.name}`,
        component,
        name: row.name,
        nodeId: node.id,
        rowName: row.name,
        kind: row.type || 'variable',
        units: row.units || '',
        plottable: isPlottableRow(row),
        slidable: isSlidableRow(row),
        inScope: inScope(node.id),
        reportedName: mapping?.get(key) ?? null,
        equivalents: [],
      })
    }
  }

  const all = [...entries, ...globals.values()]
  // Variables the model makes one, as connections do, share the name libOpenCOR reports for them.
  const byReported = new Map()
  for (const entry of all) {
    if (!entry.reportedName) continue
    if (!byReported.has(entry.reportedName)) byReported.set(entry.reportedName, [])
    byReported.get(entry.reportedName).push(entry)
  }
  for (const group of byReported.values()) {
    if (group.length < 2) continue
    for (const entry of group) entry.equivalents = group.filter((other) => other !== entry).map((other) => other.path)
  }
  return all.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Searches the index: every word of the query must appear in an entry's path, in any order ("na g" finds
 * `Na_channel/g_Na`). Exact variable names come first, then names starting with a word, then shorter paths.
 *
 * @param {ReturnType<typeof buildVariableIndex>} index
 * @param {string} query
 * @param {Object} [options]
 * @param {Function} [options.filter] - Keeps an entry, such as only plottable ones.
 * @param {number} [options.limit=200]
 * @returns {ReturnType<typeof buildVariableIndex>}
 */
export function searchVariableIndex(index, query, { filter = () => true, limit = 200 } = {}) {
  const words = (query ?? '').toLowerCase().split(/[\s/]+/).filter(Boolean)
  const scored = []
  for (const entry of index) {
    if (!filter(entry)) continue
    const path = entry.path.toLowerCase()
    if (!words.every((word) => path.includes(word))) continue
    const name = entry.name.toLowerCase()
    const rank = words.some((word) => name === word) ? 0 : words.some((word) => name.startsWith(word)) ? 1 : 2
    scored.push({ entry, rank })
  }
  scored.sort((a, b) => a.rank - b.rank || a.entry.path.length - b.entry.path.length || a.entry.path.localeCompare(b.entry.path))
  return scored.slice(0, limit).map(({ entry }) => entry)
}
