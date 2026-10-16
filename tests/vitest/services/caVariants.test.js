import { describe, expect, it } from 'vitest'

import {
  configSignature,
  foldVariantModule,
  foldVariantNodes,
  foldVariantPorts,
  variantSubtype,
} from '../../../src/services/caVariants.js'
import { normaliseConfig, normalisePorts, restorePorts } from '../../../src/utils/config.js'

const port = (portType, label, variables = ['x'], multiportType = 'None') => ({ portType, label, variables, multiportType })
const entry = (overrides = {}) => ({
  module_type: 'vessel',
  module_subtype: 'vp',
  module_format: 'cellml',
  component_file: 'BG_modules.cellml',
  component_type: 'vp_simple_type',
  entrance_ports: [{ port_type: 'vessel_port', variables: ['v_in', 'u'] }],
  exit_ports: [],
  general_ports: [],
  variables_and_units: [
    ['C', 'm3_per_J', 'access', 'constant'],
    ['R', 'Js_per_m6', 'access', 'constant'],
  ],
  ...overrides,
})

describe('configSignature', () => {
  it('reads a config by its content, whatever its subtype or the order of its variables', () => {
    const reordered = entry({ module_subtype: 'vp__other', variables_and_units: [...entry().variables_and_units].reverse() })
    expect(configSignature(reordered)).toBe(configSignature(entry()))
    expect(configSignature(entry({ variables_and_units: [['C', 'm3_per_J', 'access', 'global_constant']] }))).not.toBe(
      configSignature(entry())
    )
  })
})

describe('variantSubtype', () => {
  it('names a variant from its subtype and a hash of its config, the same on every export', () => {
    const signature = configSignature(entry())
    expect(variantSubtype('vp', signature)).toMatch(/^vp__[0-9a-z]{8}$/)
    expect(variantSubtype('vp', signature)).toBe(variantSubtype('vp', configSignature(entry())))
    expect(variantSubtype('vp', signature)).not.toBe(variantSubtype('vp', configSignature(entry({ component_type: 'other' }))))
  })
})

describe('variant port metadata', () => {
  it("writes a changed port's own fields under phlynx_ keys, and reads them back as its original", () => {
    const ports = [
      { ...port('general_ports', 'link__1', ['a']), original: { label: 'link', portType: 'entrance_ports', index: 1 } },
      { ...port('exit_ports', 'vessel_port', ['v']), original: { variables: ['v', 'u'], multiportType: ['sum', 'True'] } },
    ]
    const config = restorePorts(ports)
    expect(config.general_ports).toEqual([
      { port_type: 'link__1', variables: ['a'], phlynx_label: 'link', phlynx_port_type: 'entrance_ports', phlynx_index: 1 },
    ])
    expect(config.exit_ports).toEqual([
      { port_type: 'vessel_port', variables: ['v'], phlynx_variables: ['v', 'u'], phlynx_multi_port: ['sum', 'True'] },
    ])
    expect(normalisePorts(config).map((p) => p.original)).toEqual([
      { label: 'link', portType: 'entrance_ports', index: 1 },
      { variables: ['v', 'u'], multiportType: ['sum', 'True'] },
    ])
  })

  it("reads a variant entry's base module", () => {
    expect(normaliseConfig(entry({ module_subtype: 'vp__abc', phlynx_base_subtype: 'vp' }))).toMatchObject({
      moduleRef: 'vessel:vp__abc',
      baseModuleRef: 'vessel:vp',
    })
    expect(normaliseConfig(entry())).not.toHaveProperty('baseModuleRef')
  })

  it("writes a whole-port Multiply's factor as CA's multiply_factor, and reads it back", () => {
    const config = restorePorts([{ ...port('exit_ports', 'flow_port', ['v'], 'Multiply'), multiplyFactor: 2 }])
    expect(config.exit_ports).toEqual([{ port_type: 'flow_port', variables: ['v'], multi_port: 'Multiply', multiply_factor: 2 }])
    expect(normalisePorts(config)[0].multiplyFactor).toBe(2)
    expect(restorePorts([{ ...port('exit_ports', 'flow_port', ['v'], 'Multiply'), multiplyFactor: 1 }]).exit_ports[0]).not.toHaveProperty('multiply_factor')
  })

  it('rejects a multiply_factor CA would, when reading a config strictly', () => {
    const config = { module_type: 'm', module_subtype: 's', exit_ports: [{ port_type: 'p', variables: ['v'], multi_port: 'True', multiply_factor: 2 }] }
    expect(() => normalisePorts(config, { strict: true })).toThrow('multiply_factor only applies to "Multiply" ports')
    expect(normalisePorts(config)[0]).not.toHaveProperty('multiplyFactor')
  })
})

describe('foldVariantPorts', () => {
  it('gives back the labels, types, variables and places the variant changed', () => {
    const variant = normalisePorts({
      general_ports: [
        { port_type: 'link__1', variables: ['b'], phlynx_label: 'link', phlynx_port_type: 'entrance_ports', phlynx_index: 0 },
      ],
      entrance_ports: [{ port_type: 'link', variables: ['a'] }],
      exit_ports: [{ port_type: 'vessel_port', variables: ['v'], phlynx_variables: ['v', 'u'] }],
    })
    const { ports, of } = foldVariantPorts(variant)
    expect(ports).toEqual([port('entrance_ports', 'link', ['b']), port('entrance_ports', 'link', ['a']), port('exit_ports', 'vessel_port', ['v', 'u'])])
    expect(of.get(variant[0])).toBe(ports[0])
  })

  it('folds a variant module back onto the module it stands in for', () => {
    const module = normaliseConfig(
      entry({ module_subtype: 'vp__abc', phlynx_base_subtype: 'vp', exit_ports: [{ port_type: 'vessel_port__1', variables: ['v'], phlynx_label: 'vessel_port' }] })
    )
    expect(foldVariantModule(module)).toMatchObject({ moduleRef: 'vessel:vp', ports: [port('entrance_ports', 'vessel_port', ['v_in', 'u']), port('exit_ports', 'vessel_port', ['v'])] })
    expect(foldVariantModule(module)).not.toHaveProperty('baseModuleRef')
  })
})

describe('foldVariantNodes', () => {
  it("moves an instance's couplings onto its folded ports, with their slots", () => {
    const variantPorts = normalisePorts({
      exit_ports: [
        { port_type: 'vessel_port__1', variables: ['a'], phlynx_label: 'vessel_port' },
        { port_type: 'vessel_port', variables: ['b'] },
      ],
    })
    const target = port('entrance_ports', 'vessel_port', ['c'])
    const nodes = [
      { id: 's', data: { name: 's', moduleRef: 'split:pv__abc', ports: variantPorts } },
      { id: 't', data: { name: 't', moduleRef: 'vessel:vp', ports: [target] } },
    ]
    const edges = [{ id: 'e', source: 's', target: 't', data: { couplings: [{ sourcePort: variantPorts[1], targetPort: target, sourceSlot: 0, targetSlot: 0 }] } }]

    foldVariantNodes(nodes, edges, [{ baseModuleRef: 'split:pv' }, {}])
    expect(nodes[0].data.moduleRef).toBe('split:pv')
    expect(nodes[0].data.ports.map((p) => p.label)).toEqual(['vessel_port', 'vessel_port'])
    expect(edges[0].data.couplings).toEqual([{ sourcePort: nodes[0].data.ports[1], targetPort: target, sourceSlot: 1, targetSlot: 0 }])
  })
})
