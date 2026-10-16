// @vitest-environment happy-dom
import { useVueFlow } from '@vue-flow/core'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCanvasDelete } from '../../../src/composables/useCanvasDelete.js'
import { useCanvasLevel } from '../../../src/composables/useCanvasLevel.js'
import { useFlowHistory } from '../../../src/composables/useFlowHistory.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { FLOW_IDS } from '../../../src/utils/constants.js'
import { exposed, exposures, module, port, superInstance, supermodule } from '../fixtures/hierarchy/graph.js'

/** Root: a module, one super instance of lung (sm_1, holding a wall module it exposes a port of) and two of heart (sm_2). */
function graph() {
  const lung = supermodule('sm_1', 'lung')
  const exposure = exposures('sm_1', [exposed('xp_in', 'dndnode_0', 'entrance_ports', 'vessel')])
  const wall = module('dndnode_0', 'wall', { scope: 'sm_1', ports: [port('entrance_ports', 'vessel', ['v'])] })
  const heart = supermodule('sm_2', 'heart')
  return {
    nodes: [
      module('dndnode_0', 'a'),
      superInstance({ nodes: [lung, wall], edges: exposure }, 'dndnode_1', 'lung', 'sm_1'),
      superInstance([heart], 'dndnode_2', 'left', 'sm_2'),
      superInstance([heart], 'dndnode_3', 'right', 'sm_2'),
      lung,
      wall,
      heart,
    ],
    edges: exposure,
  }
}

describe('useCanvasDelete', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const level = useCanvasLevel()
  let history, listeners, confirm, canvasDelete

  const ids = () => flow.nodes.value.map((node) => node.id)
  const select = (...nodeIds) => nodeIds.forEach((id) => (flow.findNode(id).selected = true))

  beforeEach(async () => {
    setActivePinia(createPinia())
    history = useFlowHistoryStore()
    flow.applyDefault.value = false
    const { onNodeChange, onEdgeChange } = useFlowHistory({
      suppressedEdgeIds: new Set(),
      indexAddEdge: vi.fn(),
      indexRemoveEdge: vi.fn(),
      updateHelperLines: vi.fn(),
      revertHandlesForEdge: vi.fn(),
      reactivateEdgeHandles: vi.fn(),
    })
    listeners = [flow.onNodesChange(onNodeChange), flow.onEdgesChange(onEdgeChange)]
    level.reset()
    // fromObject keeps the selection of nodes it replaces by id, so start from an empty flow.
    await flow.fromObject({ nodes: [], edges: [] })
    await flow.fromObject(level.withVisibility(graph()))
    confirm = vi.fn()
    canvasDelete = useCanvasDelete({ confirm, history })
  })
  afterEach(() => {
    listeners.forEach((listener) => listener.off())
    flow.applyDefault.value = true
  })

  it('knows when the selection leaves a super-module without super instances', () => {
    expect(canvasDelete.selectionNeedsAsking.value).toBe(false)
    select('dndnode_0', 'dndnode_2')
    expect(canvasDelete.selectionNeedsAsking.value).toBe(false)
    select('dndnode_3')
    expect(canvasDelete.selectionNeedsAsking.value).toBe(true)
  })

  it('deletes the super instance and, when told to, its super-module, as one undo step', async () => {
    confirm.mockResolvedValue(true)
    await canvasDelete.deleteNodes(['dndnode_1'])
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("'lung'") }))
    expect(ids()).toEqual(['dndnode_0', 'dndnode_2', 'dndnode_3', 'sm_2'])
    expect(history.pointerIndex).toBe(0)

    await history.undo()
    expect(ids().sort()).toEqual(['dndnode_0', 'dndnode_1', 'dndnode_2', 'dndnode_3', 'sm_1', 'sm_1~dndnode_0', 'sm_2'])
    expect(flow.findNode('sm_1').hidden).toBe(true)
    expect(flow.findNode('dndnode_1').hidden).toBeFalsy()
  })

  it('keeps the super-module when told to', async () => {
    confirm.mockResolvedValue(false)
    await canvasDelete.deleteNodes(['dndnode_1'])
    expect(ids()).toEqual(['dndnode_0', 'dndnode_2', 'dndnode_3', 'sm_1', 'sm_1~dndnode_0', 'sm_2'])
  })

  it('asks nothing while the super-module has other super instances', async () => {
    select('dndnode_2')
    await canvasDelete.deleteSelection()
    expect(confirm).not.toHaveBeenCalled()
    expect(ids()).not.toContain('dndnode_2')
    expect(ids()).toContain('sm_2')
  })

  it('deletes nothing when the question is closed without an answer', async () => {
    confirm.mockResolvedValue(null)
    await canvasDelete.deleteNodes(['dndnode_1'])
    expect(ids()).toContain('dndnode_1')
    expect(history.canUndo).toBe(false)
  })

  it('deletes nothing while the question stays open', async () => {
    confirm.mockReturnValue(new Promise(() => {}))
    canvasDelete.deleteNodes(['dndnode_1'])
    await flushPromises()
    expect(ids()).toContain('dndnode_1')
    expect(ids()).toContain('sm_1')
    expect(history.canUndo).toBe(false)
  })

  it('keeps a super-module an undo gave a super instance back while the question was open', async () => {
    await canvasDelete.deleteNodes(['dndnode_3'])
    let answer
    confirm.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const deleting = canvasDelete.deleteNodes(['dndnode_2'])
    await flushPromises()
    await history.undo()
    expect(ids()).toContain('dndnode_3')
    answer(true)
    await deleting
    expect(ids()).not.toContain('dndnode_2')
    expect(ids()).toContain('sm_2')
    expect(flow.findNode('dndnode_3').data.smId).toBe('sm_2')
  })

  it('skips nodes an undo removed while the question was open', async () => {
    let answer
    confirm.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const deleting = canvasDelete.deleteNodes(['dndnode_1'])
    await flushPromises()
    flow.removeNodes(['dndnode_1'])
    const pointer = history.pointerIndex
    answer(true)
    await deleting
    // Nothing of the deletion left to make: the super-module is no longer orphaned by it, so stays.
    expect(ids()).toContain('sm_1')
    expect(history.pointerIndex).toBe(pointer)
  })

  describe('inside a super-module', () => {
    beforeEach(() => level.enter('dndnode_1'))

    it('asks before deleting a node an exposed port aliases', async () => {
      select('sm_1~dndnode_0')
      expect(canvasDelete.selectionNeedsAsking.value).toBe(true)
      confirm.mockResolvedValue(false)
      await canvasDelete.deleteSelection()
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({ header: 'Delete Exposed Nodes?', message: expect.stringContaining("'wall' (port 'vessel' of 'lung')") })
      )
      expect(ids()).toContain('sm_1~dndnode_0')
      expect(history.canUndo).toBe(false)
    })

    it('deletes it as one undo step when told to', async () => {
      confirm.mockResolvedValue(true)
      await canvasDelete.deleteNodes(['sm_1~dndnode_0'])
      expect(ids()).not.toContain('sm_1~dndnode_0')
      expect(history.pointerIndex).toBe(0)
      await history.undo()
      expect(ids()).toContain('sm_1~dndnode_0')
    })
  })
})
