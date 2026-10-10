// @vitest-environment happy-dom
import createLibOpenCOR from '@opencor/libopencor'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { analyzeMathXml } from '../../../src/services/math/analyzeMath.js'
import { reconcileRows } from '../../../src/services/math/reconcileRows.js'
import { createSimulationSession } from '../../../src/services/simulation/engine.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { extractVoiAndParametersFromModel, generateFlattenedModel } from '../../../src/utils/cellml.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const UNITS = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="units">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
</model>`
// dq/dtime = k * t: integrates over `time`, with a parameter that happens to be called t (#614).
const TIME_AND_T_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="tank">
  <component name="tank">
    <variable name="time" units="second" interface="public"/>
    <variable name="t" units="dimensionless" interface="public"/>
    <variable name="k" units="per_second" interface="public"/>
    <variable name="q" units="dimensionless" initial_value="q_init" interface="public"/>
    <variable name="q_init" units="dimensionless" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>time</ci></bvar><ci>q</ci></apply>
        <apply><times/><ci>k</ci><ci>t</ci></apply>
      </apply>
    </math>
  </component>
</model>`
// dq/dtau = -k * q: integrates over a time that isn't named t or time.
const TAU_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay">
  <component name="decay">
    <variable name="tau" units="second" interface="public"/>
    <variable name="k" units="per_second" interface="public"/>
    <variable name="q" units="dimensionless" initial_value="q_init" interface="public"/>
    <variable name="q_init" units="dimensionless" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>tau</ci></bvar><ci>q</ci></apply>
        <apply><minus/><apply><times/><ci>k</ci><ci>q</ci></apply></apply>
      </apply>
    </math>
  </component>
</model>`
// y = a * t: no ODE, so an algebraic system; its t is a length, not time.
const ALGEBRAIC_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="lever">
  <component name="lever">
    <variable name="a" units="dimensionless" interface="public"/>
    <variable name="t" units="metre" interface="public"/>
    <variable name="y" units="metre" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><ci>y</ci><apply><times/><ci>a</ci><ci>t</ci></apply></apply>
    </math>
  </component>
</model>`

/** The variables of a component connected to environment/time in a flattened model. */
const connectedToTime = (text, component) => {
  const connection = text.match(new RegExp(`<connection component_1="environment" component_2="${component}">([\\s\\S]*?)</connection>`))?.[1] ?? ''
  return [...connection.matchAll(/<map_variables variable_1="time" variable_2="([^"]+)"\/>/g)].map((match) => match[1])
}

describe('time and algebraic systems in the flattened model', () => {
  let store

  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    store.addUnitsFile({ componentFile: 'units.cellml', model: UNITS })
  })

  /** A node built from stored math, as a new instance's rows are, with the given values. */
  function buildNode(id, xml, values) {
    const mathRef = `file:${id}`
    store.addMath(mathRef, xml)
    const rows = reconcileRows(analyzeMathXml(xml)).map((row) => (row.name in values ? { ...row, value: values[row.name] } : row))
    return { id, type: 'instanceNode', data: { name: id, mathRef, variables: rows, ports: [] } }
  }

  const flatten = async (nodes) => (await generateFlattenedModel(nodes, [], store)).text()

  it('connects the variable of integration to the clock, and leaves a parameter called t its value (#614)', async () => {
    const node = buildNode('tank', TIME_AND_T_XML, { t: '0.2', k: '1', q_init: '0' })
    const types = Object.fromEntries(node.data.variables.map((row) => [row.name, row.type]))
    expect(types).toMatchObject({ time: 'variable', t: 'constant' })

    const text = await flatten([node])
    expect(connectedToTime(text, 'tank')).toEqual(['time'])
    expect(text).toMatch(/<variable name="t"[^>]*initial_value="0\.2"/)
  })

  it('recognises a variable of integration that isn’t named t or time', async () => {
    const node = buildNode('decay', TAU_XML, { k: '1', q_init: '1' })
    const text = await flatten([node])
    expect(connectedToTime(text, 'decay')).toEqual(['tau'])
    expect(extractVoiAndParametersFromModel(text, {}).voi).toMatchObject({ name: 'time', componentName: 'environment' })
  })

  it('builds a model without ODEs as an algebraic system, with no clock', async () => {
    const node = buildNode('lever', ALGEBRAIC_XML, { a: '3', t: '2' })
    expect(node.data.variables.find((row) => row.name === 't').type).toBe('constant')

    // The build analyses the model, so it would throw were anything left unknown.
    const text = await flatten([node])
    expect(text).not.toMatch(/<component name="environment"/)
    expect(extractVoiAndParametersFromModel(text, {}).voi).toBeNull()
  })

  it('solves an algebraic system once in libOpenCOR, as a steady state', async () => {
    const text = await flatten([buildNode('lever', ALGEBRAIC_XML, { a: '3', t: '2' })])
    const session = createSimulationSession({ module: await createLibOpenCOR(), cellml: text })
    try {
      const results = await session.run({ settings: {} }).promise
      expect(results.isSteadyState).toBe(true)
      expect(results.voi.values).toHaveLength(0)
      expect([...results.variables.get('lever/y').values]).toEqual([6])
    } finally {
      session.dispose()
    }
  }, 60000)
})
