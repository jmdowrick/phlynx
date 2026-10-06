/**
 * Plotted variables, stored in simulationSettingsStore.plotConfig as `{ groups, groupedSelections, selections }`.
 * Shared by SimSettingsDialog and the instance editor's Plot tab, so both save the same shape.
 */

/**
 * Builds a plot group id from its position.
 *
 * @param {number} index
 * @returns {string}
 */
export function makeGroupId(index) {
  return `plot-${index + 1}`
}

/**
 * Fills in group ids and names, starting with one "Plot 1" group when there are none.
 *
 * @param {Array<{id?: string, name?: string}>} [existingGroups]
 * @returns {Array<{id: string, name: string}>}
 */
export function normaliseGroups(existingGroups) {
  if (!Array.isArray(existingGroups) || existingGroups.length === 0) {
    return [{ id: makeGroupId(0), name: 'Plot 1' }]
  }

  return existingGroups.map((group, index) => ({
    id: group.id || makeGroupId(index),
    name: group.name || `Plot ${index + 1}`,
  }))
}

/**
 * Builds a plotted-variable selection for a node's variable row.
 *
 * @param {Object} node - A workspace node with `data.name`.
 * @param {Object} row - One of the node's `data.variables` rows.
 * @param {string|null} groupId
 * @returns {Object} A `plotConfig.selections` entry.
 */
export function createPlotSelection(node, row, groupId) {
  return {
    key: `${node.id}::${row.name}`,
    nodeId: node.id,
    nodeName: node.data.name,
    variableName: row.name,
    units: row.units || '',
    type: row.type || 'variable',
    plot: true,
    groupId,
  }
}

/**
 * Builds a plot config from its groups and plotted selections. Selections whose group is missing are
 * kept ungrouped, after the grouped ones.
 *
 * @param {Array<{id: string, name: string}>} groups
 * @param {Array<Object>} selections - `plotConfig.selections` entries.
 * @returns {{groups: Array, groupedSelections: Array, selections: Array}}
 */
export function buildPlotConfig(groups, selections) {
  const groupIds = new Set(groups.map((group) => group.id))

  const groupedSelections = groups
    .map((group) => ({
      id: group.id,
      name: group.name,
      selections: selections.filter((selection) => selection.groupId === group.id),
    }))
    .filter((group) => group.selections.length > 0)

  const ungroupedSelections = selections
    .filter((selection) => !groupIds.has(selection.groupId))
    .map((selection) => ({ ...selection, groupId: null }))

  return {
    groups: groups.map((group) => ({ ...group })),
    groupedSelections,
    selections: [...groupedSelections.flatMap((group) => group.selections), ...ungroupedSelections],
  }
}

/**
 * Checks whether a node's row can be plotted: only variables the simulation computes.
 *
 * @param {Object} row
 * @returns {boolean}
 */
export function isPlottableRow(row) {
  return Boolean(row?.name) && (row.type || 'variable') === 'variable'
}

/**
 * Builds one row per plottable variable across the nodes, carrying any existing selection's group.
 *
 * @param {Array<Object>} nodes - Workspace nodes.
 * @param {Map<string, Object>} selectedByKey - Existing selections by key.
 * @returns {Array<Object>} Rows sorted by node name, then variable name.
 */
export function buildPlotVariableRows(nodes, selectedByKey) {
  const rows = []

  for (const node of nodes || []) {
    if (!node?.data?.name) continue
    for (const variable of node.data.variables || []) {
      if (!isPlottableRow(variable)) continue

      const key = `${node.id}::${variable.name}`
      const existing = selectedByKey.get(key)

      rows.push({
        key,
        nodeId: node.id,
        nodeName: node.data.name,
        variableName: variable.name,
        units: variable.units || '',
        type: variable.type || 'variable',
        plot: existing?.plot ?? false,
        groupId: existing?.groupId ?? null,
        selected: false,
      })
    }
  }

  return rows.sort((a, b) => {
    const nodeDiff = a.nodeName.localeCompare(b.nodeName)
    if (nodeDiff !== 0) return nodeDiff
    return a.variableName.localeCompare(b.variableName)
  })
}

/**
 * Gets the variables a node plots, with their groups.
 *
 * @param {Object} plotConfig
 * @param {string} nodeId
 * @returns {Array<{name: string, groupId: string|null}>}
 */
export function getNodePlotEntries(plotConfig, nodeId) {
  return (plotConfig?.selections || [])
    .filter((selection) => selection.nodeId === nodeId)
    .map((selection) => ({ name: selection.variableName, groupId: selection.groupId ?? null }))
}

/**
 * Gets the plot groups to use. A config without groups (as an imported archive gives) gets one per group
 * its selections use, so none of them is ungrouped.
 *
 * @param {Object} plotConfig
 * @returns {Array<{id: string, name: string}>}
 */
export function resolveGroups(plotConfig) {
  if (Array.isArray(plotConfig?.groups) && plotConfig.groups.length) return normaliseGroups(plotConfig.groups)
  const usedIds = [...new Set((plotConfig?.selections || []).map((selection) => selection.groupId).filter(Boolean))]
  return normaliseGroups(usedIds.map((id, index) => ({ id, name: `Plot ${index + 1}` })))
}

/**
 * Sets a config's selections, keeping each one's group as it is and regrouping `groupedSelections` to match.
 *
 * @param {Object} plotConfig
 * @param {Array<{id: string, name: string}>} groups
 * @param {Array<Object>} selections
 * @returns {{groups: Array, groupedSelections: Array, selections: Array}}
 */
function withSelections(plotConfig, groups, selections) {
  return {
    ...plotConfig,
    groups: groups.map((group) => ({ ...group })),
    groupedSelections: groups
      .map((group) => ({
        id: group.id,
        name: group.name,
        selections: selections.filter((selection) => selection.groupId === group.id),
      }))
      .filter((group) => group.selections.length > 0),
    selections,
  }
}

/**
 * Gets one node's selections, ordered by key so two lists can be compared.
 *
 * @param {Object} plotConfig
 * @param {string} nodeId
 * @returns {Array<Object>}
 */
export function getNodeSelections(plotConfig, nodeId) {
  return (plotConfig?.selections || [])
    .filter((selection) => selection.nodeId === nodeId)
    .sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * Replaces one node's selections, leaving every other node's as they are.
 *
 * @param {Object} plotConfig
 * @param {string} nodeId
 * @param {Array<Object>} nodeSelections
 * @returns {Object} The new plot config.
 */
export function replaceNodeSelections(plotConfig, nodeId, nodeSelections) {
  const otherSelections = (plotConfig?.selections || []).filter((selection) => selection.nodeId !== nodeId)
  return withSelections(plotConfig, resolveGroups(plotConfig), [...otherSelections, ...nodeSelections])
}

/**
 * Replaces the variables one node plots. An entry without a `groupId` key joins the first group; one
 * whose group no longer exists is kept ungrouped. Other nodes' selections are left as they are.
 *
 * @param {Object} plotConfig
 * @param {Object} node - The node as saved, with `data.name` and `data.variables`.
 * @param {Array<{name: string, groupId?: string|null}>} entries
 * @returns {Object} The new plot config, or `plotConfig` itself when nothing changed.
 */
export function setNodePlotVariables(plotConfig, node, entries) {
  const groups = resolveGroups(plotConfig)
  const groupIds = new Set(groups.map((group) => group.id))
  const rowsByName = new Map((node.data.variables || []).filter(isPlottableRow).map((row) => [row.name, row]))

  const nodeSelections = []
  const seen = new Set()
  for (const entry of entries) {
    const row = rowsByName.get(entry.name)
    if (!row || seen.has(entry.name)) continue
    seen.add(entry.name)

    const requested = 'groupId' in entry ? entry.groupId : groups[0].id
    nodeSelections.push(createPlotSelection(node, row, groupIds.has(requested) ? requested : null))
  }

  const sortedNew = [...nodeSelections].sort((a, b) => a.key.localeCompare(b.key))
  if (JSON.stringify(getNodeSelections(plotConfig, node.id)) === JSON.stringify(sortedNew)) return plotConfig

  return replaceNodeSelections(plotConfig, node.id, nodeSelections)
}

/**
 * Resolves selections against the current nodes: drops those whose node or variable is gone, and
 * takes node names and units from the nodes, since a rename elsewhere doesn't update them. Groups are
 * kept as they are, so an export makes the same plots.
 *
 * @param {Object} plotConfig
 * @param {Array<Object>} nodes - Workspace nodes.
 * @returns {Object} A plot config to export; not saved.
 */
export function resolvePlotConfig(plotConfig, nodes) {
  const nodesById = new Map((nodes || []).map((node) => [node.id, node]))

  const selections = (plotConfig?.selections || []).flatMap((selection) => {
    const node = nodesById.get(selection.nodeId)
    const row = node?.data?.variables?.find((variable) => variable.name === selection.variableName)
    if (!node?.data?.name || !isPlottableRow(row)) return []
    return [createPlotSelection(node, row, selection.groupId ?? null)]
  })

  return withSelections(plotConfig, plotConfig?.groups || [], selections)
}
