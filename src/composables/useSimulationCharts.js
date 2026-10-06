/**
 * The charts of a run's results, as every simulation view shows them: the plotted variables of the simulated
 * instances, then the inspection modules' outputs, one chart per plot and unit.
 */
import { computed, unref } from 'vue'

import { normaliseGroups } from '../services/simulation/plotSelections'
import { assignSeriesSlots, chunkSeries } from '../services/simulation/seriesSlots'
import { readNodeSeries } from '../services/simulation/variableMapping'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'

// Inspection modules belong to no instance or plot group, so their outputs make a plot of their own.
const INSPECTION_PLOT = '__inspection_modules__'

/**
 * Builds the charts of the shown results.
 *
 * @param {import('vue').Ref<Array<Object>>|Array<Object>} scopeNodes - The simulated instances.
 * @returns {{xAxis: import('vue').ComputedRef<Object>, charts: import('vue').ComputedRef<Array<Object>>}}
 */
export function useSimulationCharts(scopeNodes) {
  const store = useSimulationResultsStore()
  const simulationSettingsStore = useSimulationSettingsStore()

  const xAxis = computed(() => {
    const voi = store.results?.voi
    return { label: voi?.name.split('/').pop() ?? '', unit: voi?.unit ?? '', values: voi?.values ?? new Float64Array() }
  })

  /**
   * Gets every series to plot: the plotted variables of all the simulated instances, then the inspection
   * modules' outputs, each with the plot it belongs to.
   *
   * @returns {Array<{key: string, plot: string, label: string, unit: string, values: Float64Array}>}
   */
  function collectSeries() {
    const nodesById = new Map(unref(scopeNodes).map((node) => [node.id, node]))
    const variables = (simulationSettingsStore.plotConfig?.selections ?? []).flatMap((selection) => {
      const node = nodesById.get(selection.nodeId)
      const series = node && readNodeSeries(store.results, store.mapping, node.id, selection.variableName)
      if (!series) return []
      return [{ key: `${node.id}::${selection.variableName}`, plot: selection.groupId ?? '', node, name: selection.variableName, unit: series.unit || 'dimensionless', values: series.values }]
    })
    // Name each variable's instance once there's more than one to tell apart.
    const isFromSeveral = new Set(variables.map((series) => series.node.id)).size > 1
    const labelled = variables.map(({ node, name, ...series }) => ({ ...series, label: isFromSeveral ? `${node.data.name}.${name}` : name }))
    const outputs = store.inspectionOutputs.map((output) => ({
      key: `inspection::${output.id}`,
      plot: INSPECTION_PLOT,
      label: output.name,
      unit: output.units,
      values: store.results.variables.get(output.reportedName).values,
    }))
    return [...labelled, ...outputs]
  }

  /**
   * Names a chart: its series when few, else its plot.
   *
   * @param {Array<{label: string}>} series
   * @param {string} plotName
   * @returns {string}
   */
  const titleFor = (series, plotName) =>
    series.length <= 3 ? series.map((item) => item.label).join(', ') : `${plotName} (${series.length} variables)`

  // One chart per plot and unit, since one axis can't carry two; variables from different instances share a
  // chart when they share both. A series keeps its colour while it stays plotted.
  const charts = computed(() => {
    const previousSlots = store.getSeriesSlots()
    if (!store.results) return []
    const plotNames = new Map(normaliseGroups(simulationSettingsStore.plotConfig?.groups).map((group) => [group.id, group.name]))
    plotNames.set(INSPECTION_PLOT, 'Inspection modules')

    const byPlotAndUnit = new Map()
    for (const series of collectSeries()) {
      const id = `${series.plot}#${series.unit}`
      if (!byPlotAndUnit.has(id)) byPlotAndUnit.set(id, { plot: series.plot, unit: series.unit, series: [] })
      byPlotAndUnit.get(id).series.push(series)
    }

    const nextSlots = new Map()
    const result = []
    for (const [id, { plot, unit, series }] of byPlotAndUnit) {
      chunkSeries(series).forEach((group, index) => {
        const slots = assignSeriesSlots(previousSlots, group.map((item) => item.key))
        slots.forEach((slot, key) => nextSlots.set(key, slot))
        result.push({
          key: `${id}#${index}`,
          title: titleFor(group, plotNames.get(plot) ?? 'Ungrouped'),
          unit,
          series: group.map((item) => ({ key: item.key, label: item.label, values: item.values, slot: slots.get(item.key) })),
        })
      })
    }
    store.setSeriesSlots(new Map([...previousSlots, ...nextSlots]))
    return result
  })

  return { xAxis, charts }
}
