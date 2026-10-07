// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { findSegments, useSimulationCharts } from '../../../src/composables/useSimulationCharts.js'
import { useSimulationResultsStore } from '../../../src/stores/simulationResultsStore.js'
import { useSimulationSettingsStore } from '../../../src/stores/simulationSettingsStore.js'

const NODE = { id: 'n1', data: { name: 'soma' } }

/**
 * Gives an experiment's results: g, a constant the protocol set, and V, plotted.
 *
 * @returns {Object}
 */
const experiment = () => ({
  voi: { name: 'environment/time', unit: 'second', values: Float64Array.of(0, 1, 2, 3, 4) },
  variables: new Map([
    ['instance_parameters/g', { kind: 'constant', unit: 'siemens', values: Float64Array.of(1, 1, 1, 2, 2) }],
    ['soma/V', { kind: 'state', unit: 'volt', values: Float64Array.of(0, 1, 2, 3, 4) }],
  ]),
  subs: [
    { startIndex: 0, endIndex: 2 },
    { startIndex: 2, endIndex: 4 },
  ],
})

describe('useSimulationCharts', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it("shows a protocol's run on its own time, with its sub-experiments, and the values it set first", () => {
    useSimulationSettingsStore().setSimulationSettings({ initialPoint: 0, startingPoint: 0 })
    useSimulationSettingsStore().plotConfig = { groups: [], selections: [{ key: 'n1::V', nodeId: 'n1', variableName: 'V', groupId: '' }] }
    const store = useSimulationResultsStore()
    store.finishProtocolRun({
      protocolResults: { experiments: [experiment()], issues: [], elapsedMs: 1, isStopped: false },
      inputs: new Map([['soma/g', { name: 'instance_parameters/g', isStepped: true }]]),
      experiment: 0,
      mapping: new Map([['n1::V', 'soma/V']]),
      signature: 's',
    })
    const { xAxis, charts } = useSimulationCharts([NODE])

    expect(xAxis.value.segments).toEqual([
      { from: 0, to: 2, number: 1 },
      { from: 2, to: 4, number: 2 },
    ])
    expect(charts.value.map(({ series }) => series.map(({ isStepped }) => isStepped))).toEqual([[true], [false]])
    expect(charts.value.map(({ plotLabel, title, unit }) => [plotLabel, title, unit])).toEqual([
      ['Protocol inputs', 'soma/g', 'siemens'],
      ['Ungrouped', 'soma/V', 'volt'],
    ])
  })

  it("doesn't count a protocol's time again from where the plots start", () => {
    useSimulationSettingsStore().setSimulationSettings({ initialPoint: -1, startingPoint: 0 })
    const store = useSimulationResultsStore()
    store.finishProtocolRun({ protocolResults: { experiments: [experiment()], issues: [], elapsedMs: 1, isStopped: false }, experiment: 0, mapping: new Map(), signature: 's' })

    expect([...useSimulationCharts([NODE]).xAxis.value.values]).toEqual([0, 1, 2, 3, 4])
  })
})

describe('findSegments', () => {
  it('finds no segments in a run of one, and only those a stopped run reached', () => {
    expect(findSegments(undefined, Float64Array.of(0, 1))).toEqual([])
    expect(findSegments([{ startIndex: 0, endIndex: 1 }], Float64Array.of(0, 1))).toEqual([])
    const subs = [
      { startIndex: 0, endIndex: 2 },
      { startIndex: 2, endIndex: 4 },
      { startIndex: 4, endIndex: 6 },
    ]
    expect(findSegments(subs, Float64Array.of(0, 1, 2, 3))).toEqual([
      { from: 0, to: 2, number: 1 },
      { from: 2, to: 3, number: 2 },
    ])
  })
})
