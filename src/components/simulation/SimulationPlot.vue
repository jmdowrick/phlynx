<template>
  <figure class="simulation-plot">
    <figcaption class="plot-title">
      <template v-if="titleParts">
        <template v-for="(part, index) in titleParts" :key="index"
          ><span v-if="index" class="plot-title-separator">, </span
          ><span v-if="part.component" class="plot-title-component">{{ part.component }}/</span><span>{{ part.name }}</span></template
        >
      </template>
      <template v-else>{{ title }}</template>
    </figcaption>
    <div ref="chartEl" class="plot-chart"></div>
  </figure>
</template>

<script setup>
/**
 * One simulation chart: a uPlot line chart of series that share a unit, against the variable of integration.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'

import { useColorScheme } from '../../composables/useColorScheme'
import { getChartZoom, setChartZoom } from '../../services/simulation/chartZoom'
import { SERIES_COLOURS } from '../../services/simulation/seriesSlots'

const CHROME = {
  light: { text: '#52514e', grid: '#e1e0d9', axis: '#c3c2b7' },
  dark: { text: '#c3c2b7', grid: '#2c2c2a', axis: '#383835' },
}
const props = defineProps({
  title: { type: String, required: true },
  // The title as instance/variable paths, to show each instance muted, or null to show `title`.
  titleParts: { type: Array, default: null },
  unit: { type: String, required: true },
  x: { type: Object, required: true }, // { label, unit, values }
  series: { type: Array, required: true }, // [{ key, label, slot, values }]
  height: { type: Number, default: 220 },
  // Charts with the same key show their cursors at the same time.
  syncKey: { type: String, default: null },
  // Names the chart, so it keeps its zoom when rebuilt.
  zoomKey: { type: String, default: null },
})

/**
 * Formats axis ticks to as many decimals as their spacing needs, or in exponent form when very small or
 * large, so ticks a thousandth apart don't all read 0.
 *
 * @param {Object} _ - The chart.
 * @param {number[]} splits - The tick values.
 * @returns {string[]}
 */
function formatTicks(_, splits) {
  const step = splits.length > 1 ? Math.abs(splits[1] - splits[0]) : Math.abs(splits[0]) || 1
  const largest = Math.max(...splits.map(Math.abs))
  if (largest >= 1e6 || (largest > 0 && step < 1e-4)) return splits.map((value) => (value === 0 ? '0' : value.toExponential(2)))
  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9))
  return splits.map((value) => value.toFixed(decimals))
}

/**
 * Formats a legend value to 5 significant figures.
 *
 * @param {Object} _ - The chart.
 * @param {number|null} value
 * @returns {string}
 */
/**
 * Sizes the value axis to fit its longest tick label, with room for its title.
 *
 * @param {Object} _ - The chart.
 * @param {string[]|null} values - The tick labels, once known.
 * @returns {number} Pixels.
 */
const sizeValueAxis = (_, values) => Math.max(50, Math.ceil(Math.max(0, ...(values ?? []).map((value) => value.length)) * 6.5) + 28)

const formatLegendValue = (_, value) => (value == null ? '–' : String(Number(value.toPrecision(5))))

const chartEl = ref(null)
const { isDarkMode } = useColorScheme()
let plot = null
// The time range zoomed into, kept across new values and redraws; null when showing the whole run.
let zoom = getChartZoom(props.zoomKey)
let isUpdatingData = false

/**
 * Sets the zoom again after new values, unless they no longer reach it, as after a change of time course.
 */
function restoreZoom() {
  const times = plot?.data?.[0]
  if (!zoom || !times?.length) return
  if (zoom.max <= times[0] || zoom.min >= times[times.length - 1]) {
    zoom = null
    setChartZoom(props.zoomKey, null)
    return
  }
  plot.setScale('x', zoom)
}

/**
 * Notes a zoom the viewer made (dragging across the chart) or undid (double-clicking it).
 *
 * @param {Object} chart - The uPlot chart.
 * @param {string} key - The scale that changed.
 */
function recordZoom(chart, key) {
  if (key !== 'x' || isUpdatingData) return
  const { min, max } = chart.scales.x
  const times = chart.data[0]
  if (min == null || max == null || !times?.length) return
  zoom = min > times[0] || max < times[times.length - 1] ? { min, max } : null
  setChartZoom(props.zoomKey, zoom)
}
let resizeObserver = null

const ariaLabel = computed(() => {
  const end = props.x.values.length ? ` from ${props.x.values[0]} to ${props.x.values.at(-1)} ${props.x.unit}` : ''
  return `Chart of ${props.title}, in ${props.unit}, against ${props.x.label}${end}`
})

/**
 * Builds the uPlot options for the current series and theme.
 *
 * @param {number} width
 * @returns {Object}
 */
function buildOptions(width) {
  const theme = isDarkMode.value ? 'dark' : 'light'
  const chrome = CHROME[theme]
  const axis = (label) => ({
    label,
    values: formatTicks,
    stroke: chrome.text,
    grid: { stroke: chrome.grid, width: 1 },
    ticks: { stroke: chrome.axis, width: 1 },
    font: '11px system-ui, -apple-system, "Segoe UI", sans-serif',
    labelFont: '11px system-ui, -apple-system, "Segoe UI", sans-serif',
  })
  return {
    width,
    height: props.height,
    scales: { x: { time: false } },
    // Synced charts plot different series, so hiding one mustn't hide its namesake by position elsewhere.
    cursor: { y: false, points: { size: 8 }, ...(props.syncKey && { sync: { key: props.syncKey, setSeries: false } }) },
    hooks: { setScale: [recordZoom] },
    legend: { live: true },
    axes: [axis(props.x.unit ? `${props.x.label} (${props.x.unit})` : props.x.label), { ...axis(props.unit), size: sizeValueAxis }],
    series: [
      { label: props.x.label, value: formatLegendValue },
      ...props.series.map((series) => ({
        label: series.label,
        value: formatLegendValue,
        stroke: SERIES_COLOURS[theme][series.slot],
        width: 2,
        points: { show: false },
      })),
    ],
  }
}

const buildData = () => [props.x.values, ...props.series.map((series) => series.values)]

/** Draws the chart afresh, as a change of series or theme needs. */
function draw() {
  plot?.destroy()
  if (!chartEl.value) return
  isUpdatingData = true
  plot = new uPlot(buildOptions(chartEl.value.clientWidth || 300), buildData(), chartEl.value)
  restoreZoom()
  isUpdatingData = false
  labelCanvas()
}

/** Labels the drawing for screen readers, leaving the legend and its values readable as text. */
function labelCanvas() {
  const drawing = plot?.root.querySelector('.u-wrap')
  drawing?.setAttribute('role', 'img')
  drawing?.setAttribute('aria-label', ariaLabel.value)
}

onMounted(() => {
  draw()
  resizeObserver = new ResizeObserver(([entry]) => {
    const width = Math.floor(entry.contentRect.width)
    if (plot && width > 0 && width !== plot.width) plot.setSize({ width, height: props.height })
  })
  resizeObserver.observe(chartEl.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  plot?.destroy()
  plot = null
})

watch(
  () => [props.series.map((series) => `${series.key}:${series.slot}`).join('|'), isDarkMode.value, props.x.unit, props.unit, props.syncKey],
  draw
)
watch(
  () => props.height,
  (height) => plot?.setSize({ width: plot.width, height })
)

defineExpose({
  /**
   * Gets the chart as drawn, with the colours of its series, for an image of it.
   *
   * @returns {{title: string, canvas: HTMLCanvasElement, legend: Array<{label: string, colour: string}>}|null}
   */
  snapshot() {
    if (!plot) return null
    const colours = SERIES_COLOURS[isDarkMode.value ? 'dark' : 'light']
    return { title: props.title, canvas: plot.ctx.canvas, legend: props.series.map((series) => ({ label: series.label, colour: colours[series.slot] })) }
  },
})
// New values, as a slider moving gives, keep a zoomed chart on its time range, with the values refitted to it.
watch(
  () => [props.x.values, ...props.series.map((series) => series.values)],
  () => {
    if (!plot) return
    isUpdatingData = true
    plot.setData(buildData())
    restoreZoom()
    isUpdatingData = false
    labelCanvas()
  }
)
</script>

<style scoped>
.simulation-plot {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.plot-title-component,
.plot-title-separator {
  font-weight: 400;
  color: var(--p-text-muted-color);
}

.plot-title {
  font-size: var(--dlg-fs-small, 0.8125rem);
  font-weight: 600;
  color: var(--p-text-color);
}

.plot-chart {
  width: 100%;
  min-width: 0;
}

.plot-chart :deep(.u-legend) {
  font-size: 11px;
  color: var(--p-text-muted-color);
  text-align: left;
}

.plot-chart :deep(.u-legend .u-value) {
  color: var(--p-text-color);
  font-variant-numeric: tabular-nums;
}
</style>
