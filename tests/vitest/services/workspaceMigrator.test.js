import fs from 'node:fs'
import path from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'
import { analyzeMathXml } from '../../../src/services/math/analyzeMath'
import { detectVersion, migrateWorkspace, separateNodeParameters } from '../../../src/services/workspaceMigrator'
import { PHLYNX_PROJECT_VERSION } from '../../../src/utils/constants'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'
import { legacyWorkspace } from '../helpers/legacyWorkspace.js'

const MATH_REF = 'file:decay'
const XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay">
  <component name="decay">
    <variable name="t" units="second"/>
    <variable name="x" units="metre" initial_value="1.5"/>
    <variable name="k" units="per_second" initial_value="0.5"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>
        <apply><times/><apply><minus/><ci>k</ci></apply><ci>x</ci></apply>
      </apply>
    </math>
  </component>
</model>`

const node = (variables) => ({ id: 'n1', data: { name: 'decay_1', mathRef: MATH_REF, variables, ports: [] } })
const byName = (rows) => Object.fromEntries(rows.map((row) => [row.name, row]))

describe('separateNodeParameters', () => {
  it('moves the math values into blank rows and links the state to a new initialiser', () => {
    const { nodes, mathEntries } = separateNodeParameters(
      [node([{ name: 'k', value: '', type: 'constant', units: 'per_second' }])],
      [[MATH_REF, XML]]
    )
    const rows = byName(nodes[0].data.variables)
    expect(rows.k.value).toBe('0.5')
    expect(rows.x).toMatchObject({ stateRole: 'state', initialiser: 'x_init' })
    expect(rows.x_init.value).toBe('1.5')
    expect(mathEntries[0][1]).not.toMatch(/initial_value="[\d.]+"/)
  })

  it('keeps a value the row already has', () => {
    const { nodes } = separateNodeParameters([node([{ name: 'k', value: '3', type: 'constant' }])], [[MATH_REF, XML]])
    expect(byName(nodes[0].data.variables).k.value).toBe('3')
  })

  it("gives the new initialiser the state row's value and data reference", () => {
    const { nodes } = separateNodeParameters(
      [node([{ name: 'x', value: '2', type: 'variable', data_reference: 'Jones1999' }])],
      [[MATH_REF, XML]]
    )
    expect(byName(nodes[0].data.variables).x_init).toMatchObject({ value: '2', data_reference: 'Jones1999' })
  })

  it.each([
    ['not numeric', 'k*2'],
    ['blank', '  '],
  ])('falls back to the math value when the state row is %s', (_, value) => {
    const { nodes } = separateNodeParameters([node([{ name: 'x', value, type: 'variable' }])], [[MATH_REF, XML]])
    expect(byName(nodes[0].data.variables).x_init.value).toBe('1.5')
  })

  it('gives a state with no math initial value its row value', () => {
    const xml = XML.replace('initial_value="1.5"', '')
    const { nodes } = separateNodeParameters([node([{ name: 'x', value: '2', type: 'variable' }])], [[MATH_REF, xml]])
    expect(byName(nodes[0].data.variables).x_init.value).toBe('2')
  })

  it('leaves an initialiser the math already linked alone', () => {
    const xml = XML.replace('initial_value="1.5"', 'initial_value="x0"').replace(
      '<variable name="k"',
      '<variable name="x0" units="metre" initial_value="3"/>\n    <variable name="k"'
    )
    const { nodes } = separateNodeParameters([node([{ name: 'x', value: '2', type: 'variable' }])], [[MATH_REF, xml]])
    expect(byName(nodes[0].data.variables).x0.value).toBe('3')
  })

  it('leaves separated math and its nodes alone', () => {
    const first = separateNodeParameters([node([])], [[MATH_REF, XML]])
    const second = separateNodeParameters(first.nodes, first.mathEntries)
    expect(second.nodes[0]).toBe(first.nodes[0])
    expect(second.mathEntries).toEqual(first.mathEntries)
  })
})

describe('migrateWorkspace', () => {
  it('separates the values of a current-format workspace', () => {
    const migrated = migrateWorkspace({
      version: '1.0.0',
      flow: { nodes: [node([])], edges: [] },
      store: { availableMath: [[MATH_REF, XML]] },
    })
    expect(byName(migrated.flow.nodes[0].data.variables).k.value).toBe('0.5')
    expect(migrated.store.availableMath[0][1]).not.toMatch(/initial_value="[\d.]+"/)
    expect(migrated.version).toBe(PHLYNX_PROJECT_VERSION)
  })

  it('records the values taken out of the math as its defaults', () => {
    const migrated = migrateWorkspace({
      version: '1.0.0',
      flow: { nodes: [node([])], edges: [] },
      store: { availableMath: [[MATH_REF, XML]] },
    })
    expect(new Map(new Map(migrated.store.mathDefaults).get(MATH_REF))).toEqual(
      new Map([
        ['k', '0.5'],
        ['x_init', '1.5'],
      ])
    )
  })

  it('keeps data references, moving a state\'s onto its new initialiser', () => {
    const migrated = migrateWorkspace({
      version: '1.0.0',
      flow: {
        nodes: [
          node([
            { name: 'k', value: '', type: 'constant', data_reference: 'Smith2001' },
            { name: 'x', value: '', type: 'variable', data_reference: 'Jones1999' },
          ]),
        ],
        edges: [],
      },
      store: { availableMath: [[MATH_REF, XML]] },
    })
    const rows = byName(migrated.flow.nodes[0].data.variables)
    expect(rows.k.data_reference).toBe('Smith2001')
    expect(rows.x.data_reference).toBe('Jones1999')
    expect(rows.x_init.data_reference).toBe('Jones1999')
  })

  describe('global constants', () => {
    const globalNode = (id) => ({
      ...node([{ name: 'k', value: '', type: 'global_constant', units: 'per_second' }]),
      id,
    })
    const migrateGlobals = (globalConstants, nodes = [globalNode('n1')]) =>
      new Map(
        migrateWorkspace({
          version: '1.0.0',
          flow: { nodes, edges: [] },
          store: { availableMath: [[MATH_REF, XML]], ...(globalConstants && { globalConstants }) },
        }).store.globalConstants
      )

    it('gives a global with no stored value its math value', () => {
      expect(migrateGlobals().get('k')).toEqual({ value: '0.5', units: 'per_second', data_reference: null })
    })

    it('keeps a stored value', () => {
      const stored = { value: '9', units: 'per_second', data_reference: 'Smith2001' }
      expect(migrateGlobals([['k', stored]]).get('k')).toEqual(stored)
    })

    it('fills a stored blank value', () => {
      const stored = { value: '', units: 'per_second', data_reference: 'Smith2001' }
      expect(migrateGlobals([['k', stored]]).get('k')).toEqual({ ...stored, value: '0.5' })
    })

    it('makes one entry for a global several nodes share', () => {
      const constants = migrateGlobals(undefined, [globalNode('n1'), globalNode('n2')])
      expect([...constants.keys()]).toEqual(['k'])
    })
  })

  it('gives 1.0.0 math no text layouts, and keeps any already there', () => {
    const doc = { version: '1.0.0', flow: { nodes: [node([])], edges: [] }, store: { availableMath: [[MATH_REF, XML]] } }
    const migrated = migrateWorkspace(doc)
    expect(migrated.store.mathLayouts).toEqual([])

    const layouts = [[MATH_REF, { format: 'cellml-text-layout', version: 1, components: [] }]]
    expect(migrateWorkspace({ ...doc, store: { ...doc.store, mathLayouts: layouts } }).store.mathLayouts).toBe(layouts)
  })

  it('leaves a workspace at the current version as it is', () => {
    const doc = {
      id: 'phlynx-project',
      version: PHLYNX_PROJECT_VERSION,
      flow: { nodes: [node([{ name: 'k', value: '', type: 'constant' }])], edges: [] },
      store: { availableMath: [[MATH_REF, XML]] },
      simulation: { simulationSettings: {}, plotConfig: {}, parameterScanConfig: {} },
      inspectionModules: [],
    }
    expect(migrateWorkspace(doc)).toEqual(doc)
  })

  it('gives an early 1.0.0 file the simulation block 1.0.0 requires', () => {
    const migrated = migrateWorkspace({
      info: { format_version: '1.0.0', project: 'Phlynx-Project' },
      flow: { nodes: [], edges: [] },
      store: { availableMath: [] },
    })
    expect(migrated.simulation).toMatchObject({ plotConfig: {}, parameterScanConfig: {} })
    expect(migrated.simulation.simulationSettings).toBeDefined()
  })

  it('gives a 1.1.0 file the solver settings its runs used, keeping its other settings', () => {
    const migrated = migrateWorkspace({
      id: 'phlynx-project',
      version: '1.1.0',
      flow: { nodes: [], edges: [] },
      store: { availableMath: [] },
      simulation: {
        simulationSettings: { pointInterval: 0.25, endingPoint: 3, solver: 'RungeKutta4', timeStep: 0.2, tolerance: 1e-6, maxSteps: 10000, extra: 'kept' },
        plotConfig: { groups: [] },
        parameterScanConfig: {},
      },
      inspectionModules: [],
    })
    expect(migrated.simulation.simulationSettings).toEqual({
      pointInterval: 0.25,
      endingPoint: 3,
      solver: 'CVODE',
      timeStep: 0,
      tolerance: 1e-7,
      maxSteps: 500,
      extra: 'kept',
    })
    expect(migrated.simulation.plotConfig).toEqual({ groups: [] })
  })

  it("connects each legacy edge to its own node's handle when a copied node shares its original's port uids", () => {
    const legacyNode = (id, ports) => ({
      id,
      position: { x: 0, y: 0 },
      data: { name: id, sourceFile: 'm.cellml', componentName: 'c', portLabels: [], portOptions: [], variables: [], ports },
    })
    const shared = [
      { uid: 'shared-top', side: 'top' },
      { uid: 'shared-bottom', side: 'bottom' },
    ]
    const legacyEdge = (source, target) => ({
      id: `${source}--${target}`,
      type: 'smoothstep',
      source,
      target,
      sourceHandle: 'port_shared-bottom',
      targetHandle: 'port_shared-top',
      data: { couplings: [] },
    })
    const migrated = migrateWorkspace({
      flow: {
        nodes: [legacyNode('original', shared), legacyNode('copy', shared), legacyNode('other', shared)],
        edges: [legacyEdge('original', 'other'), legacyEdge('other', 'copy')],
      },
      store: { availableModules: [], availableUnits: [], globalConstants: [] },
    })

    const handlesOf = new Map(migrated.flow.nodes.map(({ id, data }) => [id, data.handles.map((h) => `handle_${h.uid}`)]))
    for (const edge of migrated.flow.edges) {
      expect(handlesOf.get(edge.source)).toContain(edge.sourceHandle)
      expect(handlesOf.get(edge.target)).toContain(edge.targetHandle)
    }
  })

  it('refuses a version it does not know', () => {
    expect(() => migrateWorkspace({ version: '99.0.0', flow: { nodes: [] }, store: {} })).toThrow(/99\.0\.0/)
  })
})

describe('migrateWorkspace from 1.2.0', () => {
  const at120 = (flow, extra = {}) => ({
    id: 'phlynx-project',
    version: '1.2.0',
    flow: { viewport: { x: 1, y: 2, zoom: 1 }, ...flow },
    store: { availableMath: [] },
    simulation: { simulationSettings: {}, plotConfig: {}, parameterScanConfig: {} },
    inspectionModules: [],
    ...extra,
  })
  const withoutPlace = (nodes) => nodes.map(({ data: { scope: _scope, localId: _localId, ...data }, ...node }) => ({ ...node, data }))

  it('changes the SN workspace only by putting every node at the root', () => {
    const doc = readFixture('v1-2-0/sn_simple.json')
    const migrated = migrateWorkspace(structuredClone(doc))

    expect(migrated.flow.nodes.map(({ id, data }) => [id, data.scope, data.localId])).toEqual(doc.flow.nodes.map(({ id }) => [id, null, id]))
    expect({ ...migrated, flow: { ...migrated.flow, nodes: withoutPlace(migrated.flow.nodes) } }).toEqual({ ...doc, version: PHLYNX_PROJECT_VERSION })
  })

  it('keeps a scope and local id a node has', () => {
    const migrated = migrateWorkspace(at120({ nodes: [{ id: 'n1', data: { name: 'n', scope: null, localId: 'n1' } }], edges: [] }))
    expect(migrated.flow.nodes[0].data).toEqual({ name: 'n', scope: null, localId: 'n1' })
  })

  it('rewrites ids that break the id rules, with the edges and saved selections that name them, and notes each', () => {
    const nodeOf = (id) => ({ id, data: { name: `name ${id}` } })
    const selection = (nodeId, variableName) => ({ key: `${nodeId}::${variableName}`, nodeId, nodeName: `name ${nodeId}`, variableName })
    const doc = at120(
      {
        nodes: ['a/b', 'c::d', 'e~f', 'a_b', 'ok'].map(nodeOf),
        edges: [
          { id: 'a/b--c::d', source: 'a/b', target: 'c::d', sourceHandle: 'handle_1', targetHandle: 'handle_2', data: { couplings: [] } },
          { id: 'ok--e~f', source: 'ok', target: 'e~f', data: { couplings: [] } },
          { id: 'ok--a_b', source: 'ok', target: 'a_b', data: { couplings: [] } },
        ],
      },
      {
        simulation: {
          simulationSettings: { sweep: { ...selection('a/b', 'k'), family: { ...selection('c::d', 'k'), values: [1, 2] } } },
          plotConfig: { selections: [selection('e~f', 'V'), selection('ok', 'V')], groupedSelections: [[selection('a/b', 'V')]] },
          parameterScanConfig: { selections: [selection('c::d', 'R')] },
        },
        inspectionModules: [{ id: 'insp-1', name: 'probe', variables: [{ key: 'a/b::q', nodeId: 'a/b', nodeName: 'name a/b', variableName: 'q' }] }],
      }
    )
    const notes = []
    const migrated = migrateWorkspace(doc, { notes })

    expect(migrated.flow.nodes.map(({ id, data }) => [id, data.localId, data.name])).toEqual([
      ['a_b_2', 'a_b_2', 'name a/b'],
      ['c_d', 'c_d', 'name c::d'],
      ['e_f', 'e_f', 'name e~f'],
      ['a_b', 'a_b', 'name a_b'],
      ['ok', 'ok', 'name ok'],
    ])
    expect(migrated.flow.edges.map(({ id, source, target, sourceHandle }) => [id, source, target, sourceHandle])).toEqual([
      ['a_b--c_d', 'a_b_2', 'c_d', 'handle_1'],
      ['ok--e_f', 'ok', 'e_f', undefined],
      ['ok--a_b', 'ok', 'a_b', undefined],
    ])
    const { sweep } = migrated.simulation.simulationSettings
    expect([sweep.key, sweep.nodeId, sweep.family.key, sweep.family.nodeId]).toEqual(['a_b_2::k', 'a_b_2', 'c_d::k', 'c_d'])
    expect(migrated.simulation.plotConfig.selections.map(({ key, nodeId }) => [key, nodeId])).toEqual([
      ['e_f::V', 'e_f'],
      ['ok::V', 'ok'],
    ])
    expect(migrated.simulation.plotConfig.groupedSelections[0][0]).toMatchObject({ key: 'a_b_2::V', nodeId: 'a_b_2' })
    expect(migrated.simulation.parameterScanConfig.selections[0]).toMatchObject({ key: 'c_d::R', nodeId: 'c_d' })
    expect(migrated.inspectionModules[0].variables[0]).toMatchObject({ key: 'a_b_2::q', nodeId: 'a_b_2', nodeName: 'name a/b' })
    expect(notes).toEqual([
      'Node id "a/b" is now "a_b_2": ids can\'t hold "/", "::" or "~".',
      'Node id "c::d" is now "c_d": ids can\'t hold "/", "::" or "~".',
      'Node id "e~f" is now "e_f": ids can\'t hold "/", "::" or "~".',
    ])
  })

  it('renames object keys that name an old id, and keeps a name that reads as one', () => {
    const doc = at120(
      { nodes: [{ id: 'a/b', data: { name: 'a/b' } }], edges: [] },
      {
        simulation: {
          simulationSettings: {},
          plotConfig: { 'a/b::V': { colour: 'red', nodeId: 'a/b', nodeName: 'a/b' }, 'a/b': { label: 'a/b' } },
          parameterScanConfig: {},
        },
      }
    )
    const migrated = migrateWorkspace(doc)

    expect(migrated.flow.nodes[0]).toMatchObject({ id: 'a_b', data: { name: 'a/b', localId: 'a_b' } })
    expect(migrated.simulation.plotConfig).toEqual({
      'a_b::V': { colour: 'red', nodeId: 'a_b', nodeName: 'a/b' },
      a_b: { label: 'a/b' },
    })
  })

  it('notes nothing when every id keeps the rules', () => {
    const notes = []
    migrateWorkspace(readFixture('v1-2-0/sn_simple.json'), { notes })
    expect(notes).toEqual([])
  })
})

describe('detectVersion', () => {
  it('reads the version from each envelope', () => {
    expect(detectVersion({ version: '1.1.0' })).toBe('1.1.0')
    expect(detectVersion({ info: { format_version: '1.0.0', project: 'Phlynx-Project' } })).toBe('1.0.0')
    expect(detectVersion({ flow: {}, store: {} })).toBe('legacy')
  })
})

describe('migrateWorkspace over legacy modules', () => {
  let store
  let nodes
  beforeAll(async () => {
    await ensureLibCellmlReady()
    ;({ store, flow: { nodes } } = migrateWorkspace(legacyWorkspace()))
  })
  const mathRefOf = (moduleRef) => new Map(store.availableModules).get(moduleRef)?.mathRef

  it('gives each legacy module its own library module', () => {
    expect(Object.fromEntries(store.availableModules.map(([moduleRef, module]) => [moduleRef, module.mathRef]))).toEqual({
      'new_module:phlynx': 'template_modules.cellml:new_module',
      'artery:pp': 'vessel_modules.cellml:vessel',
      'artery:vp': 'vessel_modules.cellml:vessel',
      'GLUT2:default': 'User_Modules.cellml:GLUT2',
      'NKA:default': 'User_Modules.cellml:NKA',
      'vessel:default': 'User_Modules.cellml:vessel',
    })
  })

  it('lists every module in its math\'s collection', () => {
    expect(new Map(store.availableCollections)).toEqual(
      new Map([
        ['template_modules.cellml:new_module', ['new_module:phlynx']],
        ['vessel_modules.cellml:vessel', ['artery:pp', 'artery:vp']],
        ['User_Modules.cellml:GLUT2', ['GLUT2:default']],
        ['User_Modules.cellml:NKA', ['NKA:default']],
        ['User_Modules.cellml:vessel', ['vessel:default']],
      ])
    )
  })

  it('points each node at the module made from its config', () => {
    expect(nodes.map(({ data }) => [data.name, data.moduleRef])).toEqual([
      ['GLUT2_1', 'GLUT2:default'],
      ['NKA_1', 'NKA:default'],
      ['vessel_user', 'vessel:default'],
      ['vessel_library', 'artery:vp'],
    ])
    for (const { data } of nodes) expect(mathRefOf(data.moduleRef)).toBe(data.mathRef)
  })
})

const FIXTURES_DIR = path.resolve(process.cwd(), 'tests/resources/migration-versioning')
const ERAS = fs
  .readdirSync(FIXTURES_DIR)
  .filter((name) => name === 'legacy' || /^v\d+-\d+-\d+$/.test(name))
const FIXTURES = ERAS.flatMap((era) =>
  fs
    .readdirSync(path.join(FIXTURES_DIR, era))
    .filter((file) => file.endsWith('.json'))
    .map((file) => [`${era}/${file}`, era])
)

const readFixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'))

/**
 * Lists the data references a fixture gives its node rows, keyed `<node>|<variable>`.
 * A legacy file keeps them in availableParameters under `<variable>_<node>`.
 */
function expectedRowReferences(doc, era) {
  const references = new Map()
  if (era === 'legacy') {
    const byParameterName = new Map((doc.store.availableParameters ?? []).map(([, entry]) => [entry.variable_name, entry]))
    for (const { data } of doc.flow.nodes) {
      const globalNames = new Set((data.variables ?? []).filter((v) => v.type === 'global_constant').map((v) => v.name))
      for (const { name } of data.portOptions ?? []) {
        const reference = byParameterName.get(`${name}_${data.name}`)?.data_reference
        if (reference != null && !globalNames.has(name)) references.set(`${data.name}|${name}`, reference)
      }
    }
  } else {
    for (const { data } of doc.flow.nodes) {
      for (const row of data.variables ?? []) {
        if (row.data_reference != null) references.set(`${data.name}|${row.name}`, row.data_reference)
      }
    }
  }
  return references
}

const isBlankValue = (value) => value == null || String(value).trim() === ''

/**
 * Lists the value each node row gives the model, keyed `<node>|<variable>`, following a name to the
 * row it refers to. Rows the math computes are left out.
 *
 * @param {Object} doc - A 1.0.0 or 1.1.0 workspace.
 * @param {boolean} mathFallback - Whether a blank row falls back to the math's initial value, as 1.0.0 did.
 * @returns {Map<string, string>}
 */
function effectiveValues(doc, mathFallback) {
  const math = new Map(doc.store.availableMath)
  const globals = new Map(doc.store.globalConstants ?? [])
  const values = new Map()
  for (const { data } of doc.flow.nodes) {
    const analysis = analyzeMathXml(math.get(data.mathRef) ?? '')
    const initialValues = new Map((analysis?.declared ?? []).map((variable) => [variable.name, variable.initialValue]))
    const states = new Set(analysis?.stateVariables ?? [])
    const raw = new Map()
    for (const row of data.variables ?? []) {
      const isState = states.has(row.name)
      if (row.type === 'variable' && !isState) continue
      let value = row.type === 'global_constant' ? globals.get(row.name)?.value : undefined
      if (isBlankValue(value) && (mathFallback || !isState)) value = row.value
      if (isBlankValue(value) && (mathFallback || isState)) value = initialValues.get(row.name)
      raw.set(row.name, isBlankValue(value) ? '' : String(value).trim())
    }
    const resolve = (value, depth = 0) => (raw.has(value) && depth < 10 ? resolve(raw.get(value), depth + 1) : value)
    for (const [name, value] of raw) values.set(`${data.name}|${name}`, resolve(value))
  }
  return values
}

const globalReferences = (globalConstants = []) => Object.fromEntries(globalConstants.map(([name, entry]) => [name, entry.data_reference]))

describe('migrateWorkspace over saved workspaces', () => {
  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  it.each(FIXTURES)('brings %s up to the current version', (name, era) => {
    const doc = readFixture(name)
    const migrated = migrateWorkspace(doc)

    expect(migrated.version).toBe(PHLYNX_PROJECT_VERSION)
    expect(migrated.info).toBeUndefined()

    const actual = new Map(
      migrated.flow.nodes.flatMap(({ data }) => (data.variables ?? []).map((row) => [`${data.name}|${row.name}`, row.data_reference]))
    )
    for (const [key, reference] of expectedRowReferences(doc, era)) {
      expect({ key, reference: actual.get(key) }).toEqual({ key, reference })
    }

    if (era !== 'legacy') {
      expect(globalReferences(migrated.store.globalConstants)).toEqual(globalReferences(doc.store.globalConstants))
    } else {
      const parameterReferences = new Map(
        (doc.store.availableParameters ?? []).map(([, entry]) => [entry.variable_name, entry.data_reference])
      )
      for (const [constantName, reference] of Object.entries(globalReferences(migrated.store.globalConstants))) {
        if (parameterReferences.has(constantName)) expect(reference).toBe(parameterReferences.get(constantName))
      }

      // Global constants set in the app live only in store.globalConstants.
      const migratedConstants = new Map(migrated.store.globalConstants)
      for (const [constantName, { value, units }] of doc.store.globalConstants ?? []) {
        expect({ constantName, ...migratedConstants.get(constantName) }).toMatchObject({ constantName, value, units })
      }
    }

    const separatedRefs = migrated.store.availableMath
      .filter(([mathRef]) => /initial_value="[\d.eE+-]+"/.test(new Map(doc.store.availableMath ?? []).get(mathRef) ?? ''))
      .map(([mathRef]) => mathRef)
    const defaultRefs = new Set(migrated.store.mathDefaults.map(([mathRef]) => mathRef))
    for (const mathRef of separatedRefs) expect(defaultRefs).toContain(mathRef)
  })

  it.each(FIXTURES.filter(([, era]) => era === 'v1-0-0'))(
    'gives the model the same values for %s after migrating',
    (name) => {
      const doc = readFixture(name)
      const before = effectiveValues(doc, true)
      const after = effectiveValues(migrateWorkspace(doc), false)
      for (const [key, value] of before) expect({ key, value: after.get(key) }).toEqual({ key, value })
    }
  )

  it.each(FIXTURES)('migrates %s once, so loading the result again changes nothing', (name) => {
    const migrated = migrateWorkspace(readFixture(name))
    const saved = JSON.parse(JSON.stringify(migrated))
    expect(migrateWorkspace(saved)).toEqual(saved)
  })
})

describe('migrateWorkspace node colour categories', () => {
  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  it.each(FIXTURES.filter(([, era]) => era === 'legacy'))('keeps the MVP domainType of %s', (name) => {
    const doc = readFixture(name)
    doc.flow.nodes[0].data.domainType = 'membrane'
    const migrated = migrateWorkspace(doc)
    expect(migrated.flow.nodes[0].data.domainType).toBe('membrane')
    expect(migrated.flow.nodes.slice(1).every((node) => !('domainType' in node.data))).toBe(true)
  })
})

describe('migrateWorkspace handle repair', () => {
  const at130 = (nodes) => ({
    id: 'phlynx-project',
    version: PHLYNX_PROJECT_VERSION,
    flow: { viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges: [] },
    store: { availableMath: [] },
    simulation: { simulationSettings: {}, plotConfig: {}, parameterScanConfig: {} },
    inspectionModules: [],
  })

  it('gives a super instance or interface node saved without handles ghost handles, and leaves instances alone', () => {
    const instance = { id: 'dndnode_0', type: 'instanceNode', data: { name: 'lv', scope: null, localId: 'dndnode_0', handles: [] } }
    const kept = [{ uid: 'h1', side: 'left', name: '', variant: 'default' }]
    const doc = at130([
      { id: 'dndnode_1', type: 'superInstanceNode', data: { name: 'left', smId: 'sm_1', scope: null, localId: 'dndnode_1' } },
      { id: 'sm_1', type: 'supermoduleInterface', data: { scope: 'sm_1', localId: 'sm_1', supermodule: { name: 'heart' }, handles: [] } },
      { id: 'dndnode_2', type: 'superInstanceNode', data: { name: 'right', smId: 'sm_1', scope: null, localId: 'dndnode_2', handles: kept } },
      instance,
    ])
    const [sub, face, withHandles, inst] = migrateWorkspace(doc).flow.nodes

    for (const node of [sub, face]) {
      expect(node.data.handles.length).toBeGreaterThan(0)
      expect(node.data.handles.every((handle) => handle.variant === 'ghost')).toBe(true)
    }
    expect(withHandles.data.handles).toBe(kept)
    expect(inst).toBe(instance)
  })

})
