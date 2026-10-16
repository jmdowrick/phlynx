import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useLibraryStore } from '../../../src/stores/libraryStore.js'

const sub = (name, module_type, module_subtype, extra = {}) => ({ name, module_type, module_subtype, ...extra })
const HEART = {
  module_type: 'heart',
  module_subtype: 'v1',
  module_format: 'supermodule',
  default_instance: 'default',
  licence: 'CC0-1.0',
  required_citations: ['argus2026'],
  submodules: [sub('ra', 'chamber', 'v', { out_instances: ['trv'] }), sub('trv', 'valve', 'pp', { inp_instances: 'ra' })],
}
const VALVE = { module_type: 'valve', module_subtype: 'pp', component_file: 'valve.cellml', component_type: 'valve', exit_ports: [] }

describe('libraryStore super-modules', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
  })

  it('keeps super-module entries as CA-shaped templates next to the modules of the same file', () => {
    expect(store.addConfigFile('heart_modules_config.json', [VALVE, HEART])).toBe(2)
    expect(store.availableModules.has('valve:pp')).toBe(true)
    expect(store.availableModules.has('heart:v1')).toBe(false)
    expect(store.availableSupermodules.get('heart:v1')).toEqual({
      moduleRef: 'heart:v1',
      module_type: 'heart',
      module_subtype: 'v1',
      module_format: 'supermodule',
      default_parameterisation: 'default',
      licence: 'CC0-1.0',
      required_citations: ['argus2026'],
      submodules: [
        { name: 'ra', module_type: 'chamber', module_subtype: 'v', inp_instances: [], out_instances: ['trv'] },
        { name: 'trv', module_type: 'valve', module_subtype: 'pp', inp_instances: ['ra'], out_instances: [] },
      ],
      configFile: 'heart_modules_config.json',
    })
  })

  it('saves and loads its super-modules with the library state', () => {
    store.addConfigFile('heart_modules_config.json', [HEART])
    const saved = JSON.parse(JSON.stringify(store.getState()))
    expect(saved.availableSupermodules.map(([ref]) => ref)).toEqual(['heart:v1'])

    setActivePinia(createPinia())
    const loaded = useLibraryStore()
    loaded.loadState(saved)
    expect(loaded.availableSupermodules.get('heart:v1')).toEqual(store.availableSupermodules.get('heart:v1'))
    expect(JSON.parse(JSON.stringify(loaded.getState()))).toEqual(saved)
  })

  it('reports clashing definitions after adding the rest', () => {
    store.addConfigFile('a.json', [HEART])
    expect(() => store.addConfigFile('b.json', [VALVE, { ...HEART, description: 'other' }])).toThrow(
      "supermodule ('heart', 'v1') is defined twice: in a.json and in b.json."
    )
    expect(store.availableModules.has('valve:pp')).toBe(true)
    expect(store.addConfigFile('c.json', [HEART])).toBe(0)
  })

  it('refuses a type that is both a component and a super-module, either way round', () => {
    store.addConfigFile('valve.json', [VALVE])
    expect(() => store.addSupermodule({ ...HEART, moduleRef: 'valve:pp', configFile: 'x.json', submodules: [] })).toThrow(
      'are defined both as supermodules and as component modules'
    )
    store.addConfigFile('heart.json', [HEART])
    expect(() => store.addConfigFile('heart_component.json', [{ ...VALVE, module_type: 'heart', module_subtype: 'v1' }])).toThrow(
      '(heart, v1) is already a supermodule'
    )
    expect(store.availableModules.has('heart:v1')).toBe(false)
  })
})
