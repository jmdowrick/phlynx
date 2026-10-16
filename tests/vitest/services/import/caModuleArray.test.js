// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { IMPORT_KEYS } from '../../../../src/utils/constants.js'
import { getImportConfig } from '../../../../src/utils/import.js'
import { parseForRole } from '../../../../src/utils/importBatch.js'
import {
  normaliseModuleRecord,
  normaliseModuleRecords,
  toInstanceRows,
} from '../../../../src/services/import/caModuleArray.js'

const field = (key) => getImportConfig(key).fields[0]
const file = (name, text) => new File([text], name)
const parseArray = (name, text) => field(IMPORT_KEYS.INSTANCE_ARRAY).parser(file(name, text))
const parseConfig = (text) => field(IMPORT_KEYS.MODULE_CONFIG).parser(file('m_modules_config.json', text))

const HEART_RECORD = {
  name: 'heart',
  module_type: 'heart',
  module_subtype: 'Argus2026_v01',
  parameterisation: 'default',
  per_submodule_inputs: { ra: ['venous_svc'], la: ['pvn'] },
  per_submodule_outputs: { aov: ['aortic_root'] },
}

describe('reading module-array records', () => {
  it('reads both key styles as one shape', () => {
    const phlynx = normaliseModuleRecord({ name: 'a', module_type: 'x', module_subtype: 'nn', inp_instances: ['b'] })
    const libcuflynx = normaliseModuleRecord({ name: 'a', BC_type: 'nn', vessel_type: 'x', inp_vessels: ['b'] })
    expect(libcuflynx).toEqual(phlynx)
    expect(phlynx).toEqual({ name: 'a', module_type: 'x', module_subtype: 'nn', inp_instances: ['b'], out_instances: [] })
  })

  it('reads lists as arrays, space-separated strings or null', () => {
    const record = (inp, out) => normaliseModuleRecord({ name: 'a', module_type: 'x', module_subtype: 'nn', inp_instances: inp, out_instances: out })
    expect(record(['b c', 'd'], 'e  f')).toMatchObject({ inp_instances: ['b', 'c', 'd'], out_instances: ['e', 'f'] })
    expect(record(null, undefined)).toMatchObject({ inp_instances: [], out_instances: [] })
  })

  it('reads per_submodule_* as an object or a list of one-key objects, in order', () => {
    const asObject = normaliseModuleRecord(HEART_RECORD)
    const asList = normaliseModuleRecord({ ...HEART_RECORD, per_submodule_inputs: [{ ra: 'venous_svc' }, { la: ['pvn'] }] })
    expect(asList).toEqual(asObject)
    expect(Object.keys(asObject.per_submodule_inputs)).toEqual(['ra', 'la'])
  })

  it('keeps unknown keys unchanged', () => {
    const layout = { x: 1, y: [2, 3] }
    const record = normaliseModuleRecord({ name: 'a', module_type: 'x', module_subtype: 'nn', description: 'd', phlynx_layout: layout })
    expect(record.phlynx_layout).toEqual(layout)
    expect(record.description).toBe('d')
  })

  it('reads the legacy instance key as parameterisation, unless both disagree', () => {
    const base = { name: 'a', module_type: 'x', module_subtype: 'nn' }
    expect(normaliseModuleRecord({ ...base, instance: 'healthy' })).toMatchObject({ parameterisation: 'healthy' })
    expect(normaliseModuleRecord({ ...base, instance: 'healthy' })).not.toHaveProperty('instance')
    expect(() => normaliseModuleRecord({ ...base, instance: 'a', parameterisation: 'b' })).toThrow(
      `has both "parameterisation" ('b') and its older name "instance" ('a')`
    )
  })

  it('leaves path references to the CA#582 hook, which refuses them for now', () => {
    expect(() => normaliseModuleRecords([{ name: 'a', module_type: 'x', module_subtype: 'nn', out_instances: ['heart/ra'] }], 'm.json')).toThrow(
      'module array m.json, record 0 ("a"): "out_instances" names "heart/ra", a path reference. Path references are not supported until'
    )
    expect(() => normaliseModuleRecord({ ...HEART_RECORD, per_submodule_inputs: { 'soma/membrane': ['axon'] } })).toThrow('CA#582')
  })

  it('gives buildWorkflowGraph its space-separated rows, keeping the other keys', () => {
    const [row] = toInstanceRows([normaliseModuleRecord({ ...HEART_RECORD, inp_instances: ['a', 'b'] })])
    expect(row).toMatchObject({ inp_instances: 'a b', out_instances: '', per_submodule_outputs: { aov: ['aortic_root'] } })
  })
})

describe('the module array import field', () => {
  it('reads a JSON module array, in either key style', async () => {
    const json = JSON.stringify([
      { name: 'a', vessel_type: 'x', BC_type: 'nn', out_vessels: 'b' },
      { name: 'b', module_type: 'y', module_subtype: 'nn', inp_instances: ['a'] },
    ])
    const { data } = await parseArray('m_module_array.json', json)
    expect(data).toEqual([
      { name: 'a', module_type: 'x', module_subtype: 'nn', inp_instances: '', out_instances: 'b' },
      { name: 'b', module_type: 'y', module_subtype: 'nn', inp_instances: 'a', out_instances: '' },
    ])
  })

  it('reads a legacy CSV in the libcuflynx layout, cutting other cells to their first word as CA does', async () => {
    const csv = 'name,BC_type,vessel_type,inp_vessels,out_vessels,parameterisation,label\na,nn,x,,b c,default,two words\nb,nn,y,a,,,\n'
    const { data } = await parseArray('m_module_array.csv', csv)
    expect(data).toEqual([
      { name: 'a', module_type: 'x', module_subtype: 'nn', inp_instances: '', out_instances: 'b c', parameterisation: 'default', label: 'two' },
      { name: 'b', module_type: 'y', module_subtype: 'nn', inp_instances: 'a', out_instances: '' },
    ])
  })

  it('refuses a CSV mixing the layouts', async () => {
    await expect(parseArray('m.csv', 'name,module_type,BC_type,inp_instances,out_instances\na,x,nn,,\n')).rejects.toThrow(
      "module array m.csv mixes libcuflynx columns ['BC_type'] and PhLynx columns ['inp_instances', 'out_instances']"
    )
  })

  it("reports a bad record with CA's message, naming the file and record", async () => {
    await expect(parseArray('m.json', JSON.stringify([{ name: 'a', module_type: 'x' }]))).rejects.toThrow(
      'module array m.json, record 0 ("a"): "module_subtype" is required and must be a non-empty string (got None).'
    )
  })

  it('is read as a module array, not a config, from a batch', async () => {
    const candidates = [field(IMPORT_KEYS.MODULE_CONFIG), field(IMPORT_KEYS.INSTANCE_ARRAY)]
    const array = await parseForRole(file('m_module_array.json', JSON.stringify([HEART_RECORD])), candidates)
    expect(array.key).toBe(IMPORT_KEYS.INSTANCE_ARRAY)
    const config = JSON.stringify([{ module_type: 'heart', module_subtype: 'v', module_format: 'supermodule', submodules: [{ name: 'ra', module_type: 'c', module_subtype: 'v' }] }])
    expect((await parseForRole(file('m_modules_config.json', config), [...candidates].reverse())).key).toBe(IMPORT_KEYS.MODULE_CONFIG)
  })
})

describe('the module config import field', () => {
  const component = { module_type: 'a', module_subtype: 'nn', component_file: 'a.cellml', component_type: 'a_type', exit_ports: [] }

  it('checks every entry, not just the first', async () => {
    await expect(parseConfig(JSON.stringify([component, { ...component, component_file: undefined, BC_type: 'nn' }]))).rejects.toThrow(
      "module config entry (a, nn) in m_modules_config.json mixes the libcuflynx schema (has ['BC_type']) and the PhLynx schema (has ['module_subtype', 'component_type'])"
    )
  })

  it('reads libcuflynx entries in PhLynx keys and default_instance as default_parameterisation, keeping other keys', async () => {
    const libcuflynx = { vessel_type: 'v', BC_type: 'nn', module_file: 'v.cellml', module_type: 'v_type', default_instance: 'healthy', licence: 'CC0-1.0' }
    const [phlynx, ca] = await parseConfig(JSON.stringify([component, libcuflynx]))
    expect(phlynx).toEqual(component)
    expect(ca).toEqual({ module_type: 'v', module_subtype: 'nn', component_file: 'v.cellml', component_type: 'v_type', default_parameterisation: 'healthy', licence: 'CC0-1.0' })
  })

  it('reads super-module entries, keeping their keys', async () => {
    const supermodule = {
      module_type: 'heart',
      module_subtype: 'v1',
      module_format: 'supermodule',
      default_instance: 'default',
      required_citations: ['x'],
      submodules: [{ name: 'ra', module_type: 'chamber', module_subtype: 'v', out_instances: ['trv'] }, { name: 'trv', module_type: 'valve', module_subtype: 'pp' }],
    }
    const [entry] = await parseConfig(JSON.stringify([supermodule]))
    expect(entry).toMatchObject({ default_parameterisation: 'default', required_citations: ['x'], submodules: supermodule.submodules })
  })

  it("refuses a super-module whose submodule links outside it, with CA's message", async () => {
    const supermodule = { module_type: 'heart', module_subtype: 'v1', submodules: [{ name: 'ra', module_type: 'c', module_subtype: 'v', inp_instances: ['svc'] }] }
    await expect(parseConfig(JSON.stringify([component, supermodule]))).rejects.toThrow(
      `supermodule entry (heart, v1) in m_modules_config.json, submodules[0] ("ra"): "inp_vessels" names ['svc'], which are not submodules of this supermodule.`
    )
  })
})
