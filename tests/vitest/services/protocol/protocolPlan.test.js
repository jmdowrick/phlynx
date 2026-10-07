import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseObsData } from '../../../../src/services/protocol/obsDataDocument.js'
import { readProtocolInfo } from '../../../../src/services/protocol/protocolModel.js'
import {
  buildExperimentTime,
  buildLinearSpace,
  compileProtocolPlan,
  joinSegmentValues,
} from '../../../../src/services/protocol/protocolPlan.js'
import { validateProtocolInfo } from '../../../../src/services/protocol/protocolValidation.js'

const RESOURCES = join(__dirname, '../../../resources/protocols')

/**
 * Reads a protocol_info as PhLynx runs it.
 *
 * @param {Object} protocolInfo
 * @returns {Object}
 */
function read(protocolInfo) {
  const { errors, protocolInfo: valid } = validateProtocolInfo(protocolInfo)
  expect(errors).toEqual([])
  return readProtocolInfo(valid)
}

const NKE = read({ pre_times: [1], sim_times: [[100, 180]], params_to_change: { 'NKE_pump/flag_0': [[0, 1]] } })

describe('compileProtocolPlan', () => {
  it('warms up before the first sub-experiment and carries states into the next, its clock back at 0', () => {
    const { errors, experiments } = compileProtocolPlan({ view: NKE, pointInterval: 0.5 })
    expect(errors).toEqual([])
    expect(experiments).toEqual([
      {
        preTime: 1,
        modelTime: 281,
        pointCount: 561,
        subs: [
          { startIndex: 0, endIndex: 200 },
          { startIndex: 200, endIndex: 560 },
        ],
        segments: [
          {
            sub: 0,
            duration: 100,
            timeCourse: { initialTime: 0, outputStartTime: 1, outputEndTime: 101, numberOfSteps: 200 },
            values: [{ parameter: 'NKE_pump/flag_0', value: 0 }],
            carriesStates: false,
          },
          {
            sub: 1,
            duration: 180,
            timeCourse: { initialTime: 0, outputStartTime: 0, outputEndTime: 180, numberOfSteps: 360 },
            values: [{ parameter: 'NKE_pump/flag_0', value: 1 }],
            carriesStates: true,
          },
        ],
      },
    ])
  })

  it('counts points as CA does, spreading them over a sub-experiment the interval does not divide', () => {
    const view = read({ pre_times: [0], sim_times: [[0.3, 1]] })
    const [experiment] = compileProtocolPlan({ view, pointInterval: 0.1 }).experiments
    // int(0.3 / 0.1) is 2 in Python too, as 0.3 / 0.1 is 2.9999999999999996.
    expect(experiment.segments.map(({ timeCourse }) => timeCourse.numberOfSteps)).toEqual([2, 10])
    expect(experiment.pointCount).toBe(13)
  })

  it('plans every experiment afresh', () => {
    const { experiments } = compileProtocolPlan({
      view: read(JSON.parse(readFileSync(join(RESOURCES, 'NKE_pump_obs_data.json'), 'utf8')).protocol_info),
      pointInterval: 1,
    })
    expect(experiments).toHaveLength(1)
    const view = read({ pre_times: [2, 0], sim_times: [[1], [3, 1]], params_to_change: { 'a/k': [[1], [2, 3]] } })
    const plan = compileProtocolPlan({ view, pointInterval: 0.5 })
    expect(plan.experiments.map(({ segments }) => segments.map(({ carriesStates, timeCourse }) => [carriesStates, timeCourse.outputStartTime]))).toEqual([
      [[false, 2]],
      [
        [false, 0],
        [true, 0],
      ],
    ])
  })

  it('refuses sub-experiments shorter than the point interval, values that change over time and late state changes', () => {
    const view = read({
      pre_times: [0],
      sim_times: [[0.05, 1]],
      params_to_change: { 'a/x': [[1, 2]], 'a/u': [[0, 'r']] },
      protocol_shapes: { r: { type: 'ramp', from: 0, to: 1 } },
    })
    expect(compileProtocolPlan({ view, pointInterval: 0.1, kinds: new Map([['a/x', 'state']]) })).toEqual({
      errors: [
        'Experiment 1, sub-experiment 1 (0.05) is shorter than the point interval (0.1).',
        "Experiment 1, sub-experiment 2: a/x is a state, so it can only be set for the first sub-experiment.",
        "Experiment 1, sub-experiment 2: a/u changes over time, which PhLynx can't run yet.",
      ],
      experiments: [],
    })
    expect(compileProtocolPlan({ view: NKE, pointInterval: 0 }).errors).toEqual(['The point interval needs to be above 0.'])
  })
})

describe('joining segments', () => {
  it('times an experiment as CA does: from the end of the warm-up, through each sub-experiment in turn', () => {
    const [experiment] = compileProtocolPlan({ view: read({ pre_times: [0.7], sim_times: [[0.3, 0.2]] }), pointInterval: 0.1 }).experiments
    // CA: linspace(0.7, 1.0, 3) - 0.7, then linspace(1.0, 1.2, 3)[1:] - 0.7.
    const expected = [...buildLinearSpace(0.7, 0.7 + 0.3, 2)].concat([...buildLinearSpace(0.7 + 0.3, 0.7 + 0.3 + 0.2, 2)].slice(1)).map((t) => t - 0.7)
    expect([...buildExperimentTime(experiment)]).toEqual(expected)
    expect(expected[2]).not.toBe(0.3)
  })

  it('spaces times as numpy.linspace does, ending on the stop exactly', () => {
    expect([...buildLinearSpace(1, 2, 4)]).toEqual([1, 1.25, 1.5, 1.75, 2])
    expect(buildLinearSpace(0.1, 0.7, 3)[3]).toBe(0.7)
  })

  it('keeps the point two segments share once, from the first of them', () => {
    const [experiment] = compileProtocolPlan({ view: read({ pre_times: [0], sim_times: [[2, 1]] }), pointInterval: 1 }).experiments
    const joined = new Float64Array(experiment.pointCount)
    joinSegmentValues(joined, Float64Array.of(1, 2, 3), experiment.subs[0], false)
    joinSegmentValues(joined, Float64Array.of(9, 4), experiment.subs[1], true)
    expect([...joined]).toEqual([1, 2, 3, 4])
  })
})
