import { readFileSync } from 'node:fs'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildWorkflowGraph } from '../../../src/services/import/buildWorkflow.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { generateFlattenedModel, processCellMLData } from '../../../src/utils/cellml.js'
import { isBlank } from '../../../src/utils/variables.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

// Two terminals feeding one venous vessel, through the bundled BG configs and math: circulatory_autogen sums the
// terminals' flows into the vessel's v_in and shares its pressure, which the venous entrance's ["sum", "True"] gives.
const readAsset = (file) => readFileSync(`src/assets/${file}`, 'utf8')

let libcellml

function loadLibrary(store) {
  for (const [file, text] of [
    ['units.cellml', readAsset('units/units.cellml')],
    ['BG_modules.cellml', readAsset('modules/BG_modules.cellml')],
  ]) {
    const result = processCellMLData(text)
    expect(result.type).toBe('success')
    if (result.components?.length) store.addMathFile(file, result.components)
    if (result.units.count > 0) store.addUnitsFile({ componentFile: file, model: result.units.model })
  }
  store.addConfigFile('BG.json', JSON.parse(readAsset('module_configs/BG.json')))
}

/**
 * Lists the variables a variable is directly connected to, as `component.variable`.
 *
 * @param {Object} model - A libcellml model.
 * @param {string} componentName
 * @param {string} variableName
 * @returns {string[]}
 */
function connectedTo(model, componentName, variableName) {
  const component = model.componentByName(componentName, true)
  const variable = component.variableByName(variableName)
  const names = []
  for (let i = 0; i < variable.equivalentVariableCount(); i++) {
    const other = variable.equivalentVariable(i)
    const parent = other.parent()
    names.push(`${parent.name()}.${other.name()}`)
    parent.delete()
    other.delete()
  }
  variable.delete()
  component.delete()
  return names.sort()
}

describe('two terminals feeding one venous vessel', () => {
  let store

  beforeAll(async () => {
    ;({ instance: libcellml } = await ensureLibCellmlReady())
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    loadLibrary(store)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sums their flows into its v_in and shares its pressure, rather than equating the flows', async () => {
    const rows = [
      { name: 'term_a', module_type: 'terminal', module_subtype: 'pp', inp_instances: '', out_instances: 'ivc' },
      { name: 'term_b', module_type: 'terminal', module_subtype: 'pp', inp_instances: '', out_instances: 'ivc' },
      { name: 'ivc', module_type: 'venous', module_subtype: 'vp', inp_instances: 'term_a term_b', out_instances: '' },
    ]
    const { pendingInstances: nodes, pendingEdges: edges, conflicts } = buildWorkflowGraph(
      rows,
      store.availableModules,
      store.getMathAnalysis,
      [],
      null,
      store.getMathDefaults,
      { caRules: true }
    )
    expect(conflicts).toEqual([])
    expect(edges).toHaveLength(2)
    // Values only so the model builds; the coupling is what is checked.
    for (const node of nodes) {
      node.data.variables = node.data.variables.map((v) => (isBlank(v.value) ? { ...v, value: '1' } : v))
    }

    const text = await generateFlattenedModel(nodes, edges, store, [], { check: false }).text()
    const parser = new libcellml.Parser(false)
    const model = parser.parseModel(text)
    expect(parser.errorCount()).toBe(0)

    const ivcFlow = connectedTo(model, 'ivc', 'v_in')
    expect(ivcFlow).toHaveLength(1)
    expect(ivcFlow[0]).toMatch(/^generated_summations\.sum_of_v_in/)
    expect(connectedTo(model, 'term_a', 'v_T')).not.toContain('term_b.v_T')
    expect(connectedTo(model, 'term_a', 'v_T')).not.toContain('ivc.v_in')
    // The sum adds both terminals' flows.
    const sum = text.match(new RegExp(`<ci>${ivcFlow[0].split('.')[1]}</ci>\\s*<apply>\\s*<plus/>([\\s\\S]*?)</apply>`))
    expect(sum?.[1].match(/<ci>/g)).toHaveLength(2)
    expect(connectedTo(model, 'ivc', 'u').sort()).toEqual(['term_a.u_out', 'term_b.u_out'])

    model.delete()
    parser.delete()
  })
})
