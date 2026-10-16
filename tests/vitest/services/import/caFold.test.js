import { describe, expect, it, vi } from 'vitest'

import { buildCaModel, foldCaModel, importCaModuleArray, templateHash } from '../../../../src/services/import/caFold.js'
import { supermoduleTemplate } from '../../../../src/services/import/caModuleConfig.js'
import { parameterFileLoader } from '../../../../src/services/import/caParameters.js'
import { expandHierarchy } from '../../../../src/services/hierarchy/expand.js'
import { EXPOSURE_EDGE_TYPE } from '../../../../src/utils/constants.js'

vi.spyOn(console, 'warn').mockImplementation(() => {})

const port = (portType, variables, extra = {}) => ({ portType, label: 'vessel_port', variables, multiportType: 'None', ...extra })
const row = (name, value = null, type = 'constant') => ({ name, value, units: 'dimensionless', access: 'pub', type, data_reference: null })
const module = (ref, ports, variables = [row('E')]) => [ref, { moduleRef: ref, mathRef: `${ref}.cellml:x`, ports, variables }]

// A vessel and valve with one entrance and one exit; a chamber with two entrances, so its inputs take slots in turn.
const MODULES = new Map([
  module('vessel:v', [port('entrance_ports', ['v', 'u']), port('exit_ports', ['v', 'u'])], [row('E'), row('R')]),
  module('valve:pp', [port('entrance_ports', ['v', 'u_in']), port('exit_ports', ['v', 'u_out'])], [row('K')]),
  module('chamber:c', [port('entrance_ports', ['v_in', 'u']), port('entrance_ports', ['v_in2', 'u']), port('exit_ports', ['v_out', 'u'])]),
])
const rec = (name, module_type, module_subtype, inp = [], out = [], extra = {}) => ({ name, module_type, module_subtype, inp_instances: inp, out_instances: out, ...extra })
const PUMP = supermoduleTemplate(
  {
    module_type: 'pump',
    module_subtype: 'v1',
    module_format: 'supermodule',
    default_parameterisation: 'default',
    submodules: [rec('inlet', 'valve', 'pp', [], ['chamber']), rec('chamber', 'chamber', 'c', ['inlet'], ['outlet']), rec('outlet', 'valve', 'pp', ['chamber'])],
  },
  'pump/versions/v1/pump_v1_modules_config.json'
)
const library = (extra = []) => ({ supermodules: new Map([[PUMP.moduleRef, PUMP], ...extra.map((t) => [t.moduleRef, t])]), modules: MODULES })
const csv = (rows) => rows.map(([variable_name, value]) => ({ variable_name, units: 'dimensionless', value: String(value), data_reference: 'ref' }))
const FILES = new Map([
  ['pump/versions/v1/parameterisations/default/default_parameters.csv', csv([['chamber/E', 5], ['inlet/K', 0.3], ['R', 8]])],
  ['pump/versions/v1/parameterisations/alt/alt_parameters.csv', csv([['chamber/E', 7]])],
])
const load = parameterFileLoader(FILES)

/** svc → pump → art, with CA's per_submodule links. */
const pumpArray = (pump = {}) => [
  rec('svc', 'vessel', 'v', [], ['pump']),
  rec('pump', 'pump', 'v1', [], [], { per_submodule_inputs: { inlet: ['svc'] }, per_submodule_outputs: { outlet: ['art'] }, ...pump }),
  rec('art', 'vessel', 'v', ['pump']),
]

const byName = (nodes, name, scope = null) => nodes.find((node) => node.data?.name === name && (node.data?.scope ?? null) === scope)
const interfaces = (nodes) => nodes.filter((node) => node.type === 'supermoduleInterface')
const valueOf = (node, name) => node.data.variables.find((variable) => variable.name === name)?.value

/** Each expanded coupling as `source.port#slot -> target.port#slot`, names with '_' between levels, as CA's. */
const couplingsOf = ({ nodes, edges }, nameOf = (node) => node.data.name) => {
  const name = new Map(nodes.map((node) => [node.id, nameOf(node).replace(/__/g, '_')]))
  return edges
    .flatMap((edge) =>
      (edge.data?.couplings ?? []).map(
        (c) => `${name.get(edge.source)}.${c.sourcePort.portType}#${c.sourceSlot} -> ${name.get(edge.target)}.${c.targetPort.portType}#${c.targetSlot}`
      )
    )
    .sort()
}

describe('foldCaModel', () => {
  it('folds expanded modules into a super instance by path, exposing the ports the host edges use', () => {
    const model = buildCaModel(pumpArray(), library(), { load })
    const { nodes, edges, warnings } = foldCaModel(model, library(), { load })
    expect(warnings).toEqual([])

    const [sm] = interfaces(nodes)
    expect(sm.data.supermodule).toMatchObject({ name: 'pump', ca: { module_type: 'pump', module_subtype: 'v1' }, submoduleOrder: ['dndnode_0', 'dndnode_1', 'dndnode_2'] })
    expect(sm.data.supermodule.source).toMatchObject({ format: 'circulatory_autogen', moduleRef: 'pump:v1', hash: templateHash('pump:v1', library().supermodules) })
    expect(nodes.filter((node) => node.data.scope === sm.id).map((node) => node.data.name)).toEqual(['inlet', 'chamber', 'outlet', undefined])
    const pump = byName(nodes, 'pump')
    expect(pump).toMatchObject({ type: 'superInstanceNode', data: { smId: sm.id }, hidden: false })
    expect(nodes.filter((node) => (node.data.scope ?? null) === null).map((node) => node.data.name)).toEqual(['svc', 'pump', 'art'])

    // Exposure edges from the children inside, inputs before outputs.
    const exposure = edges.filter((edge) => edge.type === EXPOSURE_EDGE_TYPE)
    expect(exposure.map((edge) => [byName(nodes, 'inlet', sm.id).id === edge.source ? 'inlet' : 'outlet', edge.data.exposed])).toEqual([
      ['inlet', [{ id: 'xp_0', alias: { portType: 'entrance_ports', label: 'vessel_port', slot: 0 }, order: 0 }]],
      ['outlet', [{ id: 'xp_1', alias: { portType: 'exit_ports', label: 'vessel_port', slot: 0 }, order: 1 }]],
    ])
    expect(exposure.every((edge) => edge.target === sm.id && edge.hidden)).toBe(true)

    // The edges at the root name the exposed ports, in the super instance's own slots.
    const into = edges.find((edge) => edge.target === pump.id)
    expect(into.data.couplings).toMatchObject([{ targetPort: { exposedPortId: 'xp_0', portType: 'entrance_ports' }, targetSlot: 0, sourceSlot: 0 }])
    const outOf = edges.find((edge) => edge.source === pump.id)
    expect(outOf.data.couplings).toMatchObject([{ sourcePort: { exposedPortId: 'xp_1', portType: 'exit_ports' }, sourceSlot: 0 }])
    // The edges inside move into the super-module.
    const inside = edges.filter((edge) => edge.type !== EXPOSURE_EDGE_TYPE && byName(nodes, 'chamber', sm.id) && [edge.source, edge.target].includes(byName(nodes, 'chamber', sm.id).id))
    expect(inside).toHaveLength(2)
    expect(inside.every((edge) => edge.hidden)).toBe(true)

    // Expanded, it couples as CA's flat build does.
    const expansion = expandHierarchy(nodes, edges)
    expect(expansion.errors.filter((error) => error.severity === 'error')).toEqual([])
    expect(couplingsOf(expansion)).toEqual(couplingsOf(model))
    expect(expansion.nodes.map((node) => node.data.name).sort()).toEqual(['art', 'pump__chamber', 'pump__inlet', 'pump__outlet', 'svc'])
  })

  it('shares one super-module between occurrences with the same insides', () => {
    const rows = [
      rec('svc', 'vessel', 'v', [], ['p1', 'p2']),
      rec('p1', 'pump', 'v1', [], [], { per_submodule_inputs: { inlet: ['svc'] } }),
      rec('p2', 'pump', 'v1', [], [], { per_submodule_inputs: { inlet: ['svc'] } }),
    ]
    const { nodes, warnings } = importCaModuleArray(rows, library(), { load })
    expect(warnings).toEqual([])
    expect(interfaces(nodes)).toHaveLength(1)
    expect(['p1', 'p2'].map((name) => byName(nodes, name).data.smId)).toEqual([interfaces(nodes)[0].id, interfaces(nodes)[0].id])
  })

  it('forks an occurrence whose internal couplings differ, and warns once', () => {
    // A host listed before p2 takes p2's chamber's first entrance slot, so p2's inlet takes the second.
    const rows = [
      rec('svc', 'vessel', 'v', [], ['p1', 'p2']),
      rec('h', 'vessel', 'v', [], ['p2']),
      rec('p1', 'pump', 'v1', [], [], { per_submodule_inputs: { inlet: ['svc'] } }),
      rec('p2', 'pump', 'v1', [], [], { per_submodule_inputs: { chamber: ['h'], inlet: ['svc'] } }),
    ]
    const model = buildCaModel(rows, library(), { load })
    const { nodes, edges, warnings, supermodules } = foldCaModel(model, library(), { load })
    expect(interfaces(nodes).map((node) => node.data.supermodule.name)).toEqual(['pump', 'pump_2'])
    expect(supermodules.map(({ fork }) => fork)).toEqual([false, true])
    expect(interfaces(nodes)[1].data.supermodule.source.fork).toBe(true)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('pump (p1); pump_2 (p2)')
    expect(byName(nodes, 'p2').data.smId).toBe(interfaces(nodes)[1].id)
    expect(couplingsOf(expandHierarchy(nodes, edges))).toEqual(couplingsOf(model))
  })

  it("takes CA's parameter precedence: defaults on the super-module, then the instance's parameterisation and the host file as overrides", () => {
    const rows = [
      rec('svc', 'vessel', 'v', [], ['p1', 'p2']),
      rec('p1', 'pump', 'v1', [], [], { per_submodule_inputs: { inlet: ['svc'] } }),
      rec('p2', 'pump', 'v1', [], [], { parameterisation: 'alt', per_submodule_inputs: { inlet: ['svc'] } }),
      rec('chamber', 'chamber', 'c'),
    ]
    const hostRows = csv([['p1/chamber/E', 11], ['K_p1_outlet', 0.9], ['E_chamber', 3]])
    const { nodes, globals, warnings } = importCaModuleArray(rows, library(), { load, hostRows })
    expect(warnings).toEqual([])
    const sm = interfaces(nodes)[0]
    // Definition defaults: the super-module's default parameterisation's `chamber/E` and `inlet/K` rows.
    expect(valueOf(byName(nodes, 'chamber', sm.id), 'E')).toBe('5')
    expect(valueOf(byName(nodes, 'inlet', sm.id), 'K')).toBe('0.3')
    expect(valueOf(byName(nodes, 'outlet', sm.id), 'K')).toBe(null)
    const [inlet, chamber, outlet] = ['inlet', 'chamber', 'outlet'].map((name) => byName(nodes, name, sm.id).data.localId)
    // p2's own parameterisation, which, named, is read instead of the default; the host file's rows by path and by
    // CA's flat name, exactly.
    expect(byName(nodes, 'p2').data.overrides).toEqual({ [inlet]: { K: { value: null } }, [chamber]: { E: { value: '7' } } })
    expect(byName(nodes, 'p1').data.overrides).toEqual({ [chamber]: { E: { value: '11' } }, [outlet]: { K: { value: '0.9' } } })
    expect(valueOf(byName(nodes, 'chamber'), 'E')).toBe('3')
    // A plain row of a parameterisation sets a global constant.
    expect(globals).toEqual([{ name: 'R', value: '8', units: 'dimensionless', data_reference: 'ref' }])

    const expansion = expandHierarchy(nodes, [])
    const value = (path, name) => valueOf(expansion.nodes.find((node) => expansion.pathOf(node.id) === path), name)
    expect([value('p1/chamber', 'E'), value('p2/chamber', 'E'), value('p1/outlet', 'K'), value('p1/inlet', 'K'), value('p2/inlet', 'K')]).toEqual(['11', '7', '0.9', '0.3', null])
  })

  it("leaves a heart's ivc flow at 0 when CA feeds it from zero_flow, whatever row sets it", () => {
    const heart = module('heart:vp', [
      port('entrance_ports', ['v_ivc', 'u_ra']),
      port('entrance_ports', ['v_svc', 'u_ra']),
      port('entrance_ports', ['v_pvn', 'u_la']),
      port('exit_ports', ['v_aov', 'u_root']),
      port('exit_ports', ['v_puv', 'u_par']),
    ], [row('v_ivc', null, 'boundary_condition')])
    const lib = { ...library(), modules: new Map([...MODULES, heart]) }
    const rows = [...pumpArray(), rec('venous_svc', 'vessel', 'v', [], ['heart']), rec('pvn', 'vessel', 'v', [], ['heart']), rec('heart', 'heart', 'vp', ['venous_svc', 'pvn'], ['aorta', 'pa']), rec('aorta', 'vessel', 'v', ['heart']), rec('pa', 'vessel', 'v', ['heart'])]
    const { nodes } = importCaModuleArray(rows, lib, { load, hostRows: csv([['v_ivc_heart', 5]]) })
    expect(valueOf(byName(nodes, 'heart'), 'v_ivc')).toBe('0')
  })

  it('keeps the first value of a global two parameterisations set, and warns', () => {
    const VALVE = supermoduleTemplate(
      { module_type: 'gate', module_subtype: 'g', module_format: 'supermodule', default_parameterisation: 'default', submodules: [rec('v', 'vessel', 'v')] },
      'gate/versions/g/gate_g_modules_config.json'
    )
    const files = new Map([...FILES, ['gate/versions/g/parameterisations/default/default_parameters.csv', csv([['R', 9]])]])
    const rows = [rec('pump', 'pump', 'v1'), rec('gate', 'gate', 'g')]
    const { globals, warnings } = importCaModuleArray(rows, library([VALVE]), { load: parameterFileLoader(files) })
    expect(globals).toEqual([{ name: 'R', value: '8', units: 'dimensionless', data_reference: 'ref' }])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('the global constant "R" is set to different values')
  })

  it('folds nested super-modules from the deepest, exposing through each level', () => {
    const PAIR = supermoduleTemplate(
      {
        module_type: 'pair',
        module_subtype: 'p',
        module_format: 'supermodule',
        submodules: [rec('a', 'pump', 'v1', [], [], { per_submodule_outputs: { outlet: ['b'] } }), rec('b', 'vessel', 'v', ['a'])],
      },
      'pair.json'
    )
    const rows = [rec('two', 'pair', 'p')]
    const model = buildCaModel(rows, library([PAIR]), { load })
    const { nodes, edges } = foldCaModel(model, library([PAIR]), { load })
    const [pump, pair] = interfaces(nodes)
    expect([pump.data.supermodule.name, pair.data.supermodule.name]).toEqual(['pump', 'pair'])
    expect(byName(nodes, 'a', pair.id)).toMatchObject({ type: 'superInstanceNode', data: { smId: pump.id } })
    // a's outlet is exposed on pump, and the edge a → b in pair names it.
    const ab = edges.find((edge) => edge.source === byName(nodes, 'a', pair.id).id)
    expect(ab.data.couplings[0].sourcePort.exposedPortId).toBe('xp_0')
    const expansion = expandHierarchy(nodes, edges)
    expect(couplingsOf(expansion)).toEqual(couplingsOf(model))
    expect(expansion.pathOf(expansion.idOf('two__a__chamber'))).toBe('two/a/chamber')
  })
})
