import { describe, expect, it } from 'vitest'

import {
  addExperiment,
  addParameter,
  addSubExperiment,
  ensureProtocol,
  findObservationsAt,
  moveExperiment,
  removeExperiment,
  removeParameter,
  removeSubExperiment,
  setTiming,
  setValue,
} from '../../../../src/services/protocol/protocolEditing.js'
import { validateProtocolInfo } from '../../../../src/services/protocol/protocolValidation.js'

const DOCUMENT = {
  protocol_info: {
    pre_times: [1, 2],
    sim_times: [[1, 2], [3]],
    params_to_change: { 'a/k': [[1, 'p'], [3]] },
    protocol_shapes: { p: { events: [{ level: 1, length: 1 }] } },
    experiment_labels: ['rest', 'exercise'],
    experiment_colors: ['r', 'b'],
    comment: 'kept',
  },
  data_items: [
    { data_item_name: 'first', subexperiment_idx: 1 },
    { data_item_name: 'second', experiment_idx: 1 },
  ],
  prediction_items: [{ data_item_name: 'shown', experiment_idx: 1 }],
  unknown: { kept: true },
}

/** Checks a document still reads as CA reads it. */
const expectValid = (document) => expect(validateProtocolInfo(document.protocol_info).errors).toEqual([])

describe('protocolEditing', () => {
  it('starts a protocol of one experiment, keeping the data items of a bare list', () => {
    expect(ensureProtocol([{ data_item_name: 'x' }])).toEqual({
      data_items: [{ data_item_name: 'x' }],
      protocol_info: { pre_times: [0], sim_times: [[1]], params_to_change: {} },
    })
  })

  it('copies an experiment, without changing the document given', () => {
    const before = JSON.stringify(DOCUMENT)
    const edited = addExperiment(DOCUMENT, 0)
    expect(JSON.stringify(DOCUMENT)).toBe(before)
    expect(edited.protocol_info).toMatchObject({
      pre_times: [1, 2, 1],
      sim_times: [[1, 2], [3], [1, 2]],
      params_to_change: { 'a/k': [[1, 'p'], [3], [1, 'p']] },
      experiment_labels: ['rest', 'exercise', 'rest (copy)'],
      experiment_colors: ['r', 'b', 'g'],
      comment: 'kept',
    })
    expect(edited.unknown).toEqual({ kept: true })
    expectValid(edited)
  })

  it('removes an experiment and its observations, renumbering the rest', () => {
    const edited = removeExperiment(DOCUMENT, 0)
    expect(edited.protocol_info).toMatchObject({ pre_times: [2], sim_times: [[3]], experiment_labels: ['exercise'] })
    expect(edited.data_items).toEqual([{ data_item_name: 'second', experiment_idx: 0 }])
    expect(edited.prediction_items).toEqual([{ data_item_name: 'shown', experiment_idx: 0 }])
    // Its pulse is no longer used, which CA refuses, so it goes too.
    expect(edited.protocol_info.protocol_shapes).toEqual({})
    expectValid(edited)
  })

  it('moves an experiment, its observations with it', () => {
    const edited = moveExperiment(DOCUMENT, 1, 0)
    expect(edited.protocol_info.experiment_labels).toEqual(['exercise', 'rest'])
    expect(edited.protocol_info.params_to_change['a/k']).toEqual([[3], [1, 'p']])
    expect(edited.data_items).toEqual([
      { data_item_name: 'first', subexperiment_idx: 1, experiment_idx: 1 },
      { data_item_name: 'second', experiment_idx: 0 },
    ])
    expectValid(edited)
  })

  it('adds and removes sub-experiments, holding numbers and renumbering observations', () => {
    const added = addSubExperiment(DOCUMENT, 0)
    expect(added.protocol_info.sim_times[0]).toEqual([1, 2, 2])
    expect(added.protocol_info.params_to_change['a/k'][0]).toEqual([1, 'p', 0])
    expectValid(added)

    const removed = removeSubExperiment(DOCUMENT, 0, 0)
    expect(removed.protocol_info.sim_times[0]).toEqual([2])
    expect(removed.data_items).toEqual([{ data_item_name: 'first', subexperiment_idx: 0 }, DOCUMENT.data_items[1]])
    expect(removeSubExperiment(DOCUMENT, 1, 0).protocol_info.sim_times[1]).toEqual([3])
  })

  it('sets timings, labels, parameters and values', () => {
    let edited = setTiming(DOCUMENT, { experiment: 1, preTime: 0, sub: 0, duration: 5, label: 'run' })
    expect(edited.protocol_info).toMatchObject({ pre_times: [1, 0], sim_times: [[1, 2], [5]], experiment_labels: ['rest', 'run'] })
    edited = addParameter(edited, 'a/g', 0.5)
    expect(edited.protocol_info.params_to_change['a/g']).toEqual([[0.5, 0.5], [0.5]])
    edited = setValue(edited, { parameter: 'a/k', experiment: 0, sub: 1, value: 4 })
    expect(edited.protocol_info.protocol_shapes).toEqual({})
    edited = removeParameter(edited, 'a/g')
    expect(Object.keys(edited.protocol_info.params_to_change)).toEqual(['a/k'])
    expectValid(edited)
    expect(setTiming({ protocol_info: { pre_times: [0], sim_times: [[1]] } }, { experiment: 0, label: 'x' }).protocol_info.experiment_labels).toEqual(['x'])
  })

  it('finds the observations of an experiment or a sub-experiment', () => {
    expect(findObservationsAt(DOCUMENT, 1)).toEqual(['second', 'shown'])
    expect(findObservationsAt(DOCUMENT, 0, 1)).toEqual(['first'])
    expect(findObservationsAt([{ data_item_name: 'bare' }], 0, 0)).toEqual(['bare'])
  })
})
