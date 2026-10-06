/**
 * Colour slots for chart series: a series keeps its slot while it stays on the chart, so plotting or
 * unplotting another never recolours it.
 */

/** How many series one chart holds, one per colour of the categorical palette. */
export const SLOT_COUNT = 8

/**
 * Assigns slots to a chart's series, keeping each one's previous slot and giving new ones the lowest free.
 *
 * @param {Map<string, number>} previous - Slots by series key from the last assignment.
 * @param {string[]} keys - The chart's series, at most SLOT_COUNT.
 * @returns {Map<string, number>}
 */
export function assignSeriesSlots(previous, keys) {
  const slots = new Map()
  for (const key of keys) {
    const slot = previous.get(key)
    if (slot !== undefined && ![...slots.values()].includes(slot)) slots.set(key, slot)
  }
  for (const key of keys) {
    if (slots.has(key)) continue
    let slot = 0
    while ([...slots.values()].includes(slot)) slot++
    slots.set(key, slot)
  }
  return slots
}

/**
 * Splits series into charts of at most SLOT_COUNT, so no chart repeats a colour.
 *
 * @param {Array} series
 * @returns {Array<Array>}
 */
export function chunkSeries(series) {
  const charts = []
  for (let i = 0; i < series.length; i += SLOT_COUNT) charts.push(series.slice(i, i + SLOT_COUNT))
  return charts
}
