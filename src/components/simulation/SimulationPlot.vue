<template>
  <figure class="simulation-plot">
    <figcaption class="plot-title">{{ title }}</figcaption>
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

// The categorical palette by slot, stepped for each theme (validated against the sidebar's surfaces).
const SERIES_COLOURS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
}
const CHROME = {
  light: { text: '#52514e', grid: '#e1e0d9', axis: '#c3c2b7' },
  dark: { text: '#c3c2b7', grid: '#2c2c2a', axis: '#383835' },
}
const HEIGHT = 220

const props = defineProps({
  title: { type: String, required: true },
  unit: { type: String, required: true },
  x: { type: Object, required: true }, // { label, unit, values }
  series: { type: Array, required: true }, // [{ key, label, slot, values }]
})

const chartEl = ref(null)
const { isDarkMode } = useColorScheme()
let plot = null
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
    stroke: chrome.text,
    grid: { stroke: chrome.grid, width: 1 },
    ticks: { stroke: chrome.axis, width: 1 },
    font: '11px system-ui, -apple-system, "Segoe UI", sans-serif',
    labelFont: '11px system-ui, -apple-system, "Segoe UI", sans-serif',
  })
  return {
    width,
    height: HEIGHT,
    scales: { x: { time: false } },
    cursor: { y: false, points: { size: 8 } },
    legend: { live: true },
    axes: [axis(props.x.unit ? `${props.x.label} (${props.x.unit})` : props.x.label), axis(props.unit)],
    series: [
      { label: props.x.label },
      ...props.series.map((series) => ({
        label: series.label,
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
  plot = new uPlot(buildOptions(chartEl.value.clientWidth || 300), buildData(), chartEl.value)
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
    if (plot && width > 0 && width !== plot.width) plot.setSize({ width, height: HEIGHT })
  })
  resizeObserver.observe(chartEl.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  plot?.destroy()
  plot = null
})

watch(
  () => [props.series.map((series) => `${series.key}:${series.slot}`).join('|'), isDarkMode.value, props.x.unit, props.unit],
  draw
)
watch(
  () => [props.x.values, ...props.series.map((series) => series.values)],
  () => {
    plot?.setData(buildData())
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
