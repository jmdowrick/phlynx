/**
 * Plans a protocol's runs as circulatory_autogen makes them (protocol_executor.py): each experiment afresh, its first
 * sub-experiment after an unlogged warm-up, each later one carrying on from the states the one before ended with,
 * its clock back at 0.
 */

/**
 * Plans the runs of a protocol whose values are all numbers.
 *
 * @param {Object} options
 * @param {Object} options.view - The protocol, from readProtocolInfo.
 * @param {number} options.pointInterval - The time between output points, CA's dt.
 * @param {Map<string, string>} [options.kinds] - Each parameter's kind ('state' or 'constant'), where known.
 * @returns {{errors: string[], experiments: Array<{preTime: number, segments: Object[], subs: Array<{startIndex:
 *   number, endIndex: number}>, pointCount: number, modelTime: number}>}} Each segment is `{sub, duration, timeCourse,
 *   values, carriesStates}`:
 *   `timeCourse` as libOpenCOR takes it, `values` as `[{parameter, value}]`, and `carriesStates` when it starts from
 *   the states the segment before ended with. `subs` index each sub-experiment's points in the joined results.
 */
export function compileProtocolPlan({ view, pointInterval, kinds = new Map() }) {
  const errors = []
  if (!(pointInterval > 0) || !Number.isFinite(pointInterval)) errors.push('The point interval needs to be above 0.')

  const experiments = view.experiments.map((experiment, e) => {
    const where = (s) => `Experiment ${e + 1}, sub-experiment ${s + 1}`
    const segments = []
    const subs = []
    let pointCount = 1
    experiment.subs.forEach((sub, s) => {
      // CA's int(sim_time / dt): the points of a sub-experiment that doesn't divide evenly are spread across it.
      const numberOfSteps = Math.trunc(sub.duration / pointInterval)
      if (numberOfSteps < 1) errors.push(`${where(s)} (${sub.duration}) is shorter than the point interval (${pointInterval}).`)
      const values = []
      for (const { parameter, cells } of view.controls) {
        const cell = cells[e][s]
        if (cell.kind !== 'constant') {
          errors.push(`${where(s)}: ${parameter} changes over time, which PhLynx can't run yet.`)
          continue
        }
        // CA sets a state's initial value only before the first sub-experiment; later ones carry their states on.
        if (s > 0 && kinds.get(parameter) === 'state') {
          errors.push(`${where(s)}: ${parameter} is a state, so it can only be set for the first sub-experiment.`)
          continue
        }
        values.push({ parameter, value: cell.value })
      }
      const preTime = s === 0 ? experiment.preTime : 0
      segments.push({
        sub: s,
        duration: sub.duration,
        timeCourse: { initialTime: 0, outputStartTime: preTime, outputEndTime: preTime + sub.duration, numberOfSteps },
        values,
        carriesStates: s > 0,
      })
      // A later sub-experiment's first point repeats the last one before it, so the join keeps only one of them.
      const startIndex = pointCount - 1
      pointCount += numberOfSteps
      subs.push({ startIndex, endIndex: pointCount - 1 })
    })
    return { preTime: experiment.preTime, segments, subs, pointCount, modelTime: experiment.preTime + experiment.duration }
  })
  return { errors, experiments: errors.length ? [] : experiments }
}

/**
 * Gives evenly spaced times from start to stop, as numpy.linspace does.
 *
 * @param {number} start
 * @param {number} stop
 * @param {number} numberOfSteps
 * @returns {Float64Array} numberOfSteps + 1 times.
 */
export function buildLinearSpace(start, stop, numberOfSteps) {
  const times = new Float64Array(numberOfSteps + 1)
  const step = (stop - start) / numberOfSteps
  for (let i = 0; i < numberOfSteps; i++) times[i] = i * step + start
  times[numberOfSteps] = stop
  return times
}

/**
 * Gives an experiment's joined time as CA computes it: each sub-experiment's points from where the one before
 * ended, less the warm-up, so 0 is the end of the warm-up.
 *
 * @param {Object} experimentPlan - One of compileProtocolPlan's experiments.
 * @returns {Float64Array}
 */
export function buildExperimentTime({ preTime, segments, pointCount }) {
  const time = new Float64Array(pointCount)
  let currentTime = 0
  let index = 0
  for (const { duration, timeCourse, carriesStates } of segments) {
    if (!carriesStates) currentTime += preTime
    const times = buildLinearSpace(currentTime, currentTime + duration, timeCourse.numberOfSteps)
    for (let i = carriesStates ? 1 : 0; i < times.length; i++) time[index++] = times[i] - preTime
    currentTime += duration
  }
  return time
}

/**
 * Copies a segment's series into its experiment's joined one. A segment after the first starts at the point the one
 * before ended on, which the join keeps from the one before, as CA does.
 *
 * @param {Float64Array} joined - The experiment's series, pointCount long.
 * @param {Float64Array} values - The segment's series.
 * @param {{startIndex: number}} sub - The segment's sub-experiment, from the plan's `subs`.
 * @param {boolean} carriesStates - Whether the segment follows another.
 */
export function joinSegmentValues(joined, values, { startIndex }, carriesStates) {
  joined.set(carriesStates ? values.subarray(1) : values, carriesStates ? startIndex + 1 : startIndex)
}
