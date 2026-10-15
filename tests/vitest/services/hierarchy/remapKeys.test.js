import fs from 'node:fs'
import path from 'node:path'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { dropKeys, KEYED_STORES, UNKEYED_STORES } from '../../../../src/services/hierarchy/remapKeys.js'
import { useInspectionModuleStore } from '../../../../src/stores/inspectionModuleStore.js'
import { useSimulationResultsStore } from '../../../../src/stores/simulationResultsStore.js'
import { useSimulationSettingsStore } from '../../../../src/stores/simulationSettingsStore.js'

const STORES = path.resolve(process.cwd(), 'src/stores')

describe('the registry of stores keyed by model node id', () => {
  it('places every store, keyed or not, so a new one can’t be missed', () => {
    const ids = fs
      .readdirSync(STORES)
      .flatMap((file) => [...fs.readFileSync(path.join(STORES, file), 'utf8').matchAll(/defineStore\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]))
    const placed = [...KEYED_STORES.map((entry) => entry.id), ...Object.keys(UNKEYED_STORES)]
    expect(ids.filter((id) => !placed.includes(id)), 'Add the store to KEYED_STORES or UNKEYED_STORES in remapKeys.js.').toEqual([])
    expect(placed.filter((id) => !ids.includes(id))).toEqual([])
    for (const reason of Object.values(UNKEYED_STORES)) expect(reason).toMatch(/\S/)
  })
})

describe('dropKeys', () => {
  const selection = (nodeId) => ({ key: `${nodeId}::v`, nodeId, nodeName: nodeId, variableName: 'v', units: '', type: 'variable', plot: true, groupId: 'plot-1' })
  const isDead = (id) => id.startsWith('dndnode_1/b')
  let settings, inspection, results

  beforeEach(() => {
    setActivePinia(createPinia())
    settings = useSimulationSettingsStore()
    inspection = useInspectionModuleStore()
    results = useSimulationResultsStore()
    settings.setPlotConfig({
      groups: [{ id: 'plot-1', name: 'Plot 1', xAxis: { key: 'dndnode_1/b::x', nodeId: 'dndnode_1/b', variableName: 'x' } }],
      selections: [selection('dndnode_1/b'), selection('a')],
    })
    settings.setParameterScanConfig({ selections: [{ key: 'dndnode_1/b::k', nodeId: 'dndnode_1/b' }, { key: 'a::k', nodeId: 'a' }] })
    settings.setSimulationSettings({
      ...settings.simulationSettings,
      sweep: { key: 'a::k', nodeId: 'a', family: { key: 'dndnode_1/b::k', nodeId: 'dndnode_1/b', values: [1] } },
    })
    inspection.addModule({ id: 'i1', name: 'm', units: '', variables: [{ key: 'dndnode_1/b::v', nodeId: 'dndnode_1/b' }, { key: 'a::v', nodeId: 'a' }] })
    results.setSliderValue('dndnode_1/b::k', 2)
    results.setSliderValue('global::g', 3)
  })

  it('takes the keys of the modules gone out of every keyed store, and puts them back', () => {
    const before = JSON.stringify([settings.getState(), inspection.modules, [...results.sliderValues]])
    const { changed, restore } = dropKeys(isDead)
    expect(changed).toBe(true)
    expect(settings.plotConfig.selections.map((s) => s.nodeId)).toEqual(['a'])
    expect(settings.plotConfig.groups[0]).not.toHaveProperty('xAxis')
    expect(settings.parameterScanConfig.selections.map((s) => s.nodeId)).toEqual(['a'])
    expect(settings.simulationSettings.sweep).toEqual({ key: 'a::k', nodeId: 'a' })
    expect(inspection.modules[0].variables.map((v) => v.nodeId)).toEqual(['a'])
    expect([...results.sliderValues.keys()]).toEqual(['global::g'])
    const after = JSON.stringify([settings.getState(), inspection.modules, [...results.sliderValues]])

    restore('before')
    expect(JSON.stringify([settings.getState(), inspection.modules, [...results.sliderValues]])).toBe(before)
    restore('after')
    expect(JSON.stringify([settings.getState(), inspection.modules, [...results.sliderValues]])).toBe(after)
  })

  it('drops a sweep whose own parameter is gone', () => {
    settings.setSimulationSettings({ ...settings.simulationSettings, sweep: { key: 'dndnode_1/b::k', nodeId: 'dndnode_1/b' } })
    dropKeys(isDead)
    expect(settings.simulationSettings.sweep).toBeUndefined()
  })

  it('changes nothing when no key names a module gone', () => {
    expect(dropKeys(() => false).changed).toBe(false)
    expect(settings.plotConfig.selections).toHaveLength(2)
  })
})
