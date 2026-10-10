/**
 * Tracked runs: earlier results kept on the charts, as web OpenCOR's Track run keeps them, to compare with
 * the live run as sliders move. A tracked run's lines keep their variable's colour and are dashed and faded,
 * each run with its own dash, so the colours still say which variable a line is.
 */

/** How many runs can be tracked at once. */
export const MAX_TRACKED_RUNS = 5

/** A dash for each run number, distinct from one another at a line's width. */
export const RUN_DASHES = [
  [8, 4],
  [2, 3],
  [10, 3, 2, 3],
  [4, 4],
  [14, 4, 2, 4, 2, 4],
]

/** A tracked run's lines show at this opacity, under the live run's. */
export const TRACKED_RUN_ALPHA = 0.6

/**
 * Gets a run's dash.
 *
 * @param {number} number - The run's number, from 1.
 * @returns {number[]}
 */
export const runDash = (number) => RUN_DASHES[(number - 1) % RUN_DASHES.length]

/**
 * Names a tracked run's line after its variable's.
 *
 * @param {string} label
 * @param {number} number
 * @returns {string}
 */
export const runLabel = (label, number) => `${label} [#${number}]`

/**
 * Formats a value to 5 significant figures, as the charts' readout and the runs list show values.
 *
 * @param {number} value
 * @returns {string} The value, or '–' when it isn't a finite number.
 */
export const formatPlotValue = (value) => (Number.isFinite(value) ? String(Number(value.toPrecision(5))) : '–')

/**
 * Picks the lowest number no tracked run has, so the runs tracked at once never share a dash.
 *
 * @param {Array<{number: number}>} runs
 * @returns {number}
 */
export function nextRunNumber(runs) {
  const taken = new Set(runs.map((run) => run.number))
  let number = 1
  while (taken.has(number)) number++
  return number
}

/**
 * Fades a hex colour to the tracked runs' opacity.
 *
 * @param {string} colour - `#rrggbb`.
 * @returns {string} `#rrggbbaa`.
 */
export const fadeColour = (colour) =>
  `${colour}${Math.round(TRACKED_RUN_ALPHA * 255)
    .toString(16)
    .padStart(2, '0')}`

/**
 * Checks whether two times are the same output point.
 *
 * @param {number} a
 * @param {number} b
 * @returns {boolean}
 */
const isSameTime = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))

/**
 * Checks whether two runs have the same output points.
 *
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 * @returns {boolean}
 */
export function haveSameTimes(a, b) {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (!isSameTime(a[i], b[i])) return false
  return true
}

/**
 * Puts runs on one time axis, since a chart's lines share one. Runs with the same output points, as a slider
 * moving gives, share theirs; otherwise, as after a change of time course or a run stopped early, the axis
 * holds every run's points and each run has no value at the others'.
 *
 * @param {ArrayLike<number>} live - The live run's times.
 * @param {Array<ArrayLike<number>>} others - Each tracked run's times.
 * @returns {{values: ArrayLike<number>, align: (times: ArrayLike<number>, values: ArrayLike<number>) => ArrayLike<number>}}
 */
export function alignTimes(live, others) {
  if (others.every((times) => haveSameTimes(live, times))) return { values: live, align: (_, values) => values }
  const all = [live, ...others].flatMap((times) => Array.from(times)).sort((a, b) => a - b)
  const values = []
  for (const time of all) if (!values.length || !isSameTime(values.at(-1), time)) values.push(time)
  return {
    values,
    align(times, series) {
      if (haveSameTimes(values, times)) return series
      const aligned = new Array(values.length).fill(null)
      let j = 0
      for (let i = 0; i < times.length && i < series.length; i++) {
        while (j < values.length && values[j] < times[i] && !isSameTime(values[j], times[i])) j++
        if (j < values.length) aligned[j] = series[i]
      }
      return aligned
    },
  }
}

/**
 * Gets the times a run's charts show: from the start of its plots, when they start after the solve does
 * to let the model settle.
 *
 * @param {{voi?: {values: Float64Array}}|null} results
 * @param {{initialPoint: number, startingPoint: number}} settings - The run's simulation settings.
 * @returns {{values: Float64Array, offset: number}}
 */
export function displayTimes(results, settings) {
  const values = results?.voi?.values ?? new Float64Array()
  const { initialPoint, startingPoint } = settings ?? {}
  const isSettled = initialPoint < startingPoint && values.length > 0 && isSameTime(values[0], startingPoint)
  return isSettled ? { values: values.map((time) => time - startingPoint), offset: startingPoint } : { values, offset: 0 }
}

/**
 * Describes the slider values a run tried out, as `instance/parameter`, for the runs list.
 *
 * @param {{rows: Map<string, number>, globals: Map<string, number>}|null} overrides - The run's slider values.
 * @param {Array<Object>} definitions - The slider definitions (parameterScanConfig.selections).
 * @param {string} globalComponent - What global constants are named under.
 * @returns {Array<{key: string, label: string, value: number, units: string}>}
 */
export function describeRunInputs(overrides, definitions, globalComponent) {
  if (!overrides) return []
  const byKey = new Map((definitions ?? []).map((definition) => [definition.key, definition]))
  const byGlobal = new Map((definitions ?? []).filter((definition) => definition.type === 'global_constant').map((definition) => [definition.parameterName, definition]))
  const rows = [...overrides.rows].map(([key, value]) => {
    const definition = byKey.get(key)
    const [, parameter = key] = key.split('::')
    return { key, label: `${definition?.nodeName ?? key.split('::')[0]}/${definition?.parameterName ?? parameter}`, value, units: definition?.units ?? '' }
  })
  const globals = [...overrides.globals].map(([name, value]) => ({
    key: `global::${name}`,
    label: `${globalComponent}/${name}`,
    value,
    units: byGlobal.get(name)?.units ?? '',
  }))
  return [...rows, ...globals]
}
