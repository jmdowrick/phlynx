// @vitest-environment happy-dom
import { useVueFlow } from '@vue-flow/core'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCanvasLevel } from '../../../src/composables/useCanvasLevel.js'
import { useModelGraph } from '../../../src/composables/useModelGraph.js'
import { REVEAL_MEASURE_TIMEOUT_MS, useRevealModelNode } from '../../../src/composables/useRevealModelNode.js'
import { FLOW_IDS } from '../../../src/utils/constants.js'
import { module, subsystem, supermodule } from '../fixtures/hierarchy/graph.js'

/** Root a and heart (sm_1: ra and lv, a subsystem of sm_2 holding wall). */
function nestedGraph() {
  const lvSm = supermodule('sm_2', 'lv')
  const wall = module('dndnode_0', 'wall', { scope: 'sm_2' })
  const heartSm = supermodule('sm_1', 'heart')
  const ra = module('dndnode_7', 'ra', { scope: 'sm_1' })
  const lv = subsystem([lvSm, wall], 'dndnode_8', 'lv', 'sm_2', { scope: 'sm_1' })
  const heart = subsystem([heartSm, ra, lv], 'dndnode_1', 'heart', 'sm_1')
  return { nodes: [module('dndnode_0', 'a'), heart, heartSm, ra, lv, lvSm, wall], edges: [] }
}

describe('useRevealModelNode', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const level = useCanvasLevel()
  const { graph } = useModelGraph()
  let zoomToNode, reveal

  /** The model id of the node a store node expands to. */
  const modelIdOf = (mainId) => [...graph.value.origin].find(([, from]) => from.mainId === mainId)?.[0]
  const measure = (id) => (flow.findNode(id).dimensions = { width: 120, height: 60 })

  beforeEach(async () => {
    setActivePinia(createPinia())
    level.reset()
    await flow.fromObject(level.withVisibility(nestedGraph()))
    zoomToNode = vi.fn()
    reveal = useRevealModelNode(zoomToNode)
  })
  afterEach(() => vi.useRealTimers())

  it('enters every subsystem a node is inside, from the root, and centres on it there', () => {
    const wall = modelIdOf('sm_2~dndnode_0')
    reveal(wall)
    expect(level.scope.value).toBe('sm_2')
    expect(level.instancePath.value).toEqual(['dndnode_1', 'sm_1~dndnode_8'])
    expect(level.path.value.map((entry) => entry.name)).toEqual(['heart', 'lv'])
    expect(zoomToNode).toHaveBeenCalledWith('sm_2~dndnode_0')
    expect(level.canvasIdOf(wall)).toBe('sm_2~dndnode_0')
    expect(level.canvasIdOf(modelIdOf('sm_1~dndnode_7'))).toBeUndefined()
  })

  it('goes back up for a node at the root', () => {
    level.showInstanceChain(['dndnode_1'])
    reveal('dndnode_0')
    expect(level.isAtRoot.value).toBe(true)
    expect(zoomToNode).toHaveBeenCalledWith('dndnode_0')
  })

  it('centres on the node again once it is measured', async () => {
    reveal(modelIdOf('sm_1~dndnode_7'))
    expect(zoomToNode).toHaveBeenCalledTimes(1)
    measure('sm_1~dndnode_7')
    await nextTick()
    expect(zoomToNode).toHaveBeenCalledTimes(2)
    measure('sm_1~dndnode_7')
    await nextTick()
    expect(zoomToNode).toHaveBeenCalledTimes(2)
  })

  it('stops waiting for a node that is never measured', async () => {
    vi.useFakeTimers()
    reveal(modelIdOf('sm_1~dndnode_7'))
    vi.advanceTimersByTime(REVEAL_MEASURE_TIMEOUT_MS)
    measure('sm_1~dndnode_7')
    await nextTick()
    expect(zoomToNode).toHaveBeenCalledTimes(1)
  })

  it('does nothing for a node the model doesn’t have', () => {
    reveal('nope')
    expect(level.isAtRoot.value).toBe(true)
    expect(zoomToNode).not.toHaveBeenCalled()
  })
})
