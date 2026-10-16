// @vitest-environment happy-dom
import { useVueFlow } from '@vue-flow/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useActiveCanvas } from '../../../../src/composables/useActiveCanvas.js'
import { useMacroGenerator } from '../../../../src/services/generate/generateWorkflow.js'
import { buildSupermoduleInterface } from '../../../../src/services/import/buildWorkflow.js'
import { FLOW_IDS, MAIN_NODE_TYPE } from '../../../../src/utils/constants.js'

const macroNode = (id, name) => ({ id, type: MAIN_NODE_TYPE, position: { x: 0, y: 0 }, data: { name, variables: [], ports: [] } })

describe('useMacroGenerator', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const { scope } = useActiveCanvas()
  const { processMacroGeneration } = useMacroGenerator()
  const generated = () => flow.nodes.value.filter((node) => node.id.includes('macronode_')).map(({ id, data }) => [id, data.scope, data.localId, data.name])

  beforeEach(() => {
    flow.nodes.value = []
    flow.addNodes([buildSupermoduleInterface('sm_1', { name: 'heart' })])
  })
  afterEach(() => (scope.value = null))

  it('adds each iteration at the root with today’s ids', () => {
    processMacroGeneration({ flow: { nodes: [macroNode('m0', 'cell')], edges: [] }, repeatCount: 2 })
    expect(generated()).toEqual([
      ['macronode_1_iter_0', null, 'macronode_1_iter_0', 'cell'],
      ['macronode_1_iter_1', null, 'macronode_1_iter_1', 'cell_1'],
    ])
  })

  it('adds them in the scope shown, with its ids and names its rules allow', () => {
    scope.value = 'sm_1'
    processMacroGeneration({ flow: { nodes: [macroNode('m0', 'my__cell_')], edges: [] }, repeatCount: 2 })
    processMacroGeneration({ flow: { nodes: [macroNode('m0', 'cell')], edges: [] }, repeatCount: 1 })
    expect(generated()).toEqual([
      ['sm_1~macronode_1_iter_0', 'sm_1', 'macronode_1_iter_0', 'my_cell'],
      ['sm_1~macronode_1_iter_1', 'sm_1', 'macronode_1_iter_1', 'my_cell_1'],
      ['sm_1~macronode_2_iter_0', 'sm_1', 'macronode_2_iter_0', 'cell'],
    ])
  })
})
