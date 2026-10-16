// @vitest-environment happy-dom
import { useVueFlow } from '@vue-flow/core'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useActiveCanvas } from '../../../src/composables/useActiveCanvas.js'
import { useCanvasLevel } from '../../../src/composables/useCanvasLevel.js'
import { useClearWorkspace } from '../../../src/composables/useClearWorkspace.js'
import { useFlowHistory } from '../../../src/composables/useFlowHistory.js'
import { useSupermodules } from '../../../src/composables/useSupermodules.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { FLOW_IDS } from '../../../src/utils/constants.js'
import { connect, exposed, exposures, module, port, subsystem, supermodule } from '../fixtures/hierarchy/graph.js'

const IN = port('entrance_ports', 'vessel', ['v_in', 'u'])
const OUT = port('exit_ports', 'vessel', ['v', 'u_out'])
const vessel = (localId, name, options = {}) => module(localId, name, { ports: [{ ...IN }, { ...OUT }], ...options })

/** Root a → heart (sm_1: ra → lv) → b. */
function heartGraph() {
  const ra = vessel('dndnode_7', 'ra', { scope: 'sm_1' })
  const lv = vessel('dndnode_8', 'lv', { scope: 'sm_1' })
  const sm = supermodule('sm_1', 'heart', { submoduleOrder: ['dndnode_7', 'dndnode_8'] })
  const exposure = exposures('sm_1', [exposed('xp_in', 'dndnode_7', 'entrance_ports', 'vessel'), exposed('xp_out', 'dndnode_8', 'exit_ports', 'vessel')])
  const inner = [sm, ra, lv]
  const heart = subsystem({ nodes: inner, edges: exposure }, 'dndnode_1', 'heart', 'sm_1')
  const a = vessel('dndnode_0', 'a')
  const b = vessel('dndnode_2', 'b')
  const used = new Set()
  const edges = [connect(a, heart, { used, id: 'e_in' }), connect(heart, b, { used, id: 'e_out' }), connect(ra, lv, { id: 'e_int' }), ...exposure]
  return { nodes: [a, heart, b, ...inner], edges }
}

describe('useCanvasLevel', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const level = useCanvasLevel()
  const canvas = useActiveCanvas()
  let history, listeners, onNodeChange

  const ids = (items) => items.map((item) => item.id)
  const shownIds = () => ids(flow.nodes.value.filter((node) => !node.hidden))
  /** Commits pending commands as one step without waiting for the batch timer. */
  const commit = () => {
    history.startBatch()
    history.endBatch()
  }

  /** Loads a graph as a workspace load does: hidden worked out first, then fromObject. */
  const load = async (graph) => {
    level.reset()
    await flow.fromObject(level.withVisibility(graph))
  }

  beforeEach(async () => {
    setActivePinia(createPinia())
    history = useFlowHistoryStore()
    // Changes go through the workspace's history, as the canvas sends them.
    flow.applyDefault.value = false
    let onEdgeChange
    ;({ onNodeChange, onEdgeChange } = useFlowHistory({
      suppressedEdgeIds: new Set(),
      indexAddEdge: vi.fn(),
      indexRemoveEdge: vi.fn(),
      updateHelperLines: vi.fn(),
      revertHandlesForEdge: vi.fn(),
      reactivateEdgeHandles: vi.fn(),
    }))
    listeners = [flow.onNodesChange(onNodeChange), flow.onEdgesChange(onEdgeChange)]
    await load(heartGraph())
  })
  afterEach(() => {
    listeners.forEach((listener) => listener.off())
    flow.applyDefault.value = true
  })

  describe('visibility', () => {
    it('loads the root shown, super-modules hidden, their interface nodes undeletable', () => {
      expect(shownIds()).toEqual(['dndnode_0', 'dndnode_1', 'dndnode_2'])
      expect(flow.findEdge('e_int').hidden).toBe(true)
      expect(flow.findNode('sm_1').deletable).toBe(false)
    })

    it('leaves a workspace without super-modules as it is', () => {
      const nodes = [vessel('dndnode_0', 'a'), vessel('dndnode_1', 'b')]
      const loaded = level.withVisibility({ nodes, edges: [] })
      expect(loaded.nodes).toEqual(nodes)
      expect(loaded.nodes.every((node) => !('hidden' in node))).toBe(true)
    })
  })

  describe('navigation', () => {
    it('enters a subsystem, showing its super-module’s nodes and hiding the rest', () => {
      expect(level.enter('dndnode_1')).toBe(true)
      expect(level.scope.value).toBe('sm_1')
      expect(level.instancePath.value).toEqual(['dndnode_1'])
      expect(shownIds()).toEqual(['sm_1', 'sm_1~dndnode_7', 'sm_1~dndnode_8'])
      expect(flow.findEdge('e_int').hidden).toBe(false)
      expect(flow.findEdge('e_in').hidden).toBe(true)
      expect(level.path.value).toEqual([
        { smId: 'sm_1', instanceId: 'dndnode_1', name: 'heart', supermoduleName: 'heart', supermoduleLabel: 'heart', count: 1, occurrences: 1 },
      ])
    })

    it('enters only a subsystem on the canvas', () => {
      expect(level.enter('dndnode_0')).toBe(false)
      expect(level.enter('sm_1~dndnode_7')).toBe(false)
      expect(level.enter('missing')).toBe(false)
      expect(level.scope.value).toBeNull()
    })

    it('exits to a breadcrumb entry, or one level up', () => {
      level.enter('dndnode_1')
      expect(level.exitOne()).toBe(true)
      expect(level.isAtRoot.value).toBe(true)
      expect(shownIds()).toEqual(['dndnode_0', 'dndnode_1', 'dndnode_2'])
      expect(level.exitOne()).toBe(false)

      level.enter('dndnode_1')
      expect(level.exitTo(1)).toBe(false)
      expect(level.exitTo(0)).toBe(true)
      expect(level.path.value).toEqual([])
    })

    it('edits a super-module on its own, through no subsystem', () => {
      expect(level.editSupermodule('sm_1')).toBe(true)
      expect(level.isEditingSupermodule.value).toBe(true)
      expect(level.instancePath.value).toEqual([])
      expect(level.path.value.map(({ smId, instanceId, name }) => ({ smId, instanceId, name }))).toEqual([
        { smId: 'sm_1', instanceId: null, name: 'heart' },
      ])
      expect(shownIds()).toEqual(['sm_1', 'sm_1~dndnode_7', 'sm_1~dndnode_8'])
      expect(level.editSupermodule('sm_9')).toBe(false)
    })

    it('deselects everything, off the canvas too', () => {
      flow.findNode('dndnode_0').selected = true
      flow.findEdge('e_in').selected = true
      level.enter('dndnode_1')
      expect(flow.getSelectedNodes.value).toEqual([])
      expect(flow.getSelectedEdges.value).toEqual([])
    })

    it('names its breadcrumb as the store does, so a rename shows', () => {
      level.enter('dndnode_1')
      flow.updateNodeData('dndnode_1', { name: 'pump' })
      flow.findNode('sm_1').data.supermodule.ca = { module_type: 'heart', module_subtype: 'Argus2026_v01' }
      expect(level.path.value[0]).toMatchObject({ name: 'pump', supermoduleLabel: 'heart:Argus2026_v01' })
    })

    it('goes back to the root and forgets viewports when reset', () => {
      level.enter('dndnode_1')
      level.reset()
      expect(level.isAtRoot.value).toBe(true)
      expect(shownIds()).toEqual(['dndnode_0', 'dndnode_1', 'dndnode_2'])
    })

    it('goes back to the root when the workspace is cleared, and when the clear is undone', async () => {
      const { clearWorkspace } = useClearWorkspace()
      level.enter('dndnode_1')
      await clearWorkspace()
      expect(level.isAtRoot.value).toBe(true)
      await history.undo()
      expect(level.isAtRoot.value).toBe(true)
      expect(shownIds()).toEqual(['dndnode_0', 'dndnode_1', 'dndnode_2'])
    })

    it('undoes a clear made inside a subsystem at the root’s viewport', async () => {
      const setViewport = vi.spyOn(flow, 'setViewport').mockImplementation(() => {})
      const { clearWorkspace } = useClearWorkspace()
      flow.viewport.value = { x: 10, y: 20, zoom: 2 }
      level.enter('dndnode_1')
      flow.viewport.value = { x: -5, y: -5, zoom: 1 }
      await clearWorkspace()
      await history.undo()
      expect(setViewport).toHaveBeenLastCalledWith({ x: 10, y: 20, zoom: 2 })
      setViewport.mockRestore()
    })

    it('forgets the last workspace’s history when one is loaded, so its undo can’t act on this one', async () => {
      const { clearWorkspace } = useClearWorkspace()
      level.enter('dndnode_1')
      flow.addNodes({ id: canvas.nextNodeId(), type: 'moduleNode', position: { x: 0, y: 0 }, data: { name: 'la' } })
      commit()
      expect(history.canUndo).toBe(true)
      await clearWorkspace({ recordHistory: false })
      expect(history.canUndo).toBe(false)
      expect(history.canRedo).toBe(false)
    })

    it('shows the scope a model node is in, through its subsystems', () => {
      expect(level.showInstanceChain(['dndnode_1'])).toBe(true)
      expect(level.scope.value).toBe('sm_1')
      expect(level.showInstanceChain(['dndnode_0'])).toBe(false)
    })

    it('remembers each scope’s viewport, and gives the root’s to save', () => {
      const setViewport = vi.spyOn(flow, 'setViewport').mockImplementation(() => {})
      flow.viewport.value = { x: 10, y: 20, zoom: 2 }
      level.enter('dndnode_1')
      flow.viewport.value = { x: -5, y: -5, zoom: 1 }
      expect(level.rootViewport()).toEqual({ x: 10, y: 20, zoom: 2 })
      level.exitTo(0)
      expect(setViewport).toHaveBeenLastCalledWith({ x: 10, y: 20, zoom: 2 })
      setViewport.mockRestore()
    })
  })

  describe('selection', () => {
    it('stands for the copies through the subsystems entered', async () => {
      level.enter('dndnode_1')
      flow.findNode('sm_1~dndnode_7').selected = true
      expect(level.selectedModelIds.value).toEqual(['dndnode_1/dndnode_7'])
      expect(level.canvasIdOf('dndnode_1/dndnode_8')).toBe('sm_1~dndnode_8')
      level.exitTo(0)
      flow.findNode('dndnode_1').selected = true
      expect(level.selectedModelIds.value).toEqual(['dndnode_1/dndnode_7', 'dndnode_1/dndnode_8'])
      expect(level.canvasIdOf('dndnode_1/dndnode_8')).toBe('dndnode_1')
    })
  })

  describe('history', () => {
    it('never records navigation', () => {
      level.enter('dndnode_1')
      level.exitTo(0)
      level.editSupermodule('sm_1')
      level.reset()
      commit()
      expect(history.canUndo).toBe(false)
    })

    it('stamps a node added in a scope with it, and refuses a node whose id isn’t the scope’s', () => {
      level.enter('dndnode_1')
      const id = canvas.nextNodeId()
      expect(id).toBe('sm_1~dndnode_9')
      flow.addNodes({ id, type: 'moduleNode', position: { x: 0, y: 0 }, data: { name: 'la' } })
      expect(flow.findNode(id).data).toMatchObject({ scope: 'sm_1', localId: 'dndnode_9' })
      expect(() => flow.addNodes({ id: 'dndnode_3', position: { x: 0, y: 0 }, data: { name: 'x' } })).toThrow('does not start with its scope')
    })

    it('refuses an edge between two scopes', () => {
      const edge = (id, target) => ({ id, source: 'dndnode_0', target, sourceHandle: 'a', targetHandle: 'b' })
      expect(() => flow.addEdges(edge('e_across', 'sm_1~dndnode_7'))).toThrow('which are in different scopes')
      expect(flow.edges.value.map((item) => item.id)).not.toContain('e_across')
      expect(() => flow.addEdges(edge('e_interface', 'sm_1'))).toThrow('in different scopes')
    })

    it('goes back to where a change was made before undoing and redoing it', async () => {
      level.enter('dndnode_1')
      const id = canvas.nextNodeId()
      flow.addNodes({ id, type: 'moduleNode', position: { x: 0, y: 0 }, data: { name: 'la' } })
      commit()
      level.exitTo(0)

      await history.undo()
      expect(level.scope.value).toBe('sm_1')
      expect(level.instancePath.value).toEqual(['dndnode_1'])
      expect(flow.findNode(id)).toBeUndefined()

      level.exitTo(0)
      await history.redo()
      expect(level.scope.value).toBe('sm_1')
      expect(flow.findNode(id).hidden).toBeFalsy()
      expect(flow.findNode('dndnode_0').hidden).toBe(true)
      expect(history.canRedo).toBe(false)
    })

    it('records nothing for the nodes measured as they are shown, nor lets them rewrite an add', async () => {
      const id = canvas.nextNodeId()
      flow.addNodes({ id, type: 'moduleNode', position: { x: 0, y: 0 }, data: { name: 'c' } })
      // Entering commits the add, still waiting for its node to be measured.
      level.enter('dndnode_1')
      for (const shown of ['sm_1', 'sm_1~dndnode_7', 'sm_1~dndnode_8']) {
        onNodeChange([{ type: 'dimensions', id: shown, dimensions: { width: 120, height: 80 } }])
      }
      commit()
      expect(history.pointerIndex).toBe(0)

      await history.undo()
      expect(level.isAtRoot.value).toBe(true)
      expect(flow.findNode(id)).toBeUndefined()
      expect(flow.nodes.value).toHaveLength(6)
      await history.redo()
      expect(flow.findNode(id).position).toEqual({ x: 0, y: 0 })
    })
  })

  describe('super-modules', () => {
    const supermodules = useSupermodules()

    it('lists each with its subsystems and its copies in the model', () => {
      expect(supermodules.supermodules.value).toEqual([{ id: 'sm_1', name: 'heart', label: 'heart', count: 1, occurrences: 1 }])
    })

    it('makes an empty super-module and a subsystem of it as one undo step', async () => {
      const { smId, subsystemId } = supermodules.createEmptySubsystem('lung', { x: 5, y: 6 })
      expect(smId).toBe('sm_2')
      expect(subsystemId).toBe('dndnode_3')
      expect(flow.findNode('sm_2')).toMatchObject({ hidden: true, deletable: false })
      expect(flow.findNode('dndnode_3')).toMatchObject({ position: { x: 5, y: 6 }, data: { smId: 'sm_2', scope: null } })
      expect(flow.findNode('dndnode_3').hidden).toBeFalsy()
      expect(history.pointerIndex).toBe(0)

      await history.undo()
      expect(flow.findNode('sm_2')).toBeUndefined()
      expect(flow.findNode('dndnode_3')).toBeUndefined()
      await history.redo()
      expect(flow.findNode('sm_2').hidden).toBe(true)
      expect(flow.findNode('dndnode_3').hidden).toBeFalsy()
    })

    it('refuses a name a subsystem can’t have, or one in use', () => {
      expect(() => supermodules.createEmptySubsystem('a__b', { x: 0, y: 0 })).toThrow('"__"')
      expect(() => supermodules.createEmptySubsystem('heart', { x: 0, y: 0 })).toThrow('already used here')
      expect(supermodules.subsystemNameProblem('lung')).toBeNull()
      expect(supermodules.supermoduleNameProblem('heart')).toMatch('already called')
    })

    it('renames a super-module as one undo step, its subsystems keeping their names', async () => {
      supermodules.createEmptySubsystem('lung', { x: 0, y: 0 })
      await expect(supermodules.renameSupermodule('sm_1', 'heart', { history })).resolves.toBe(false)
      await expect(supermodules.renameSupermodule('sm_1', 'lung', { history })).rejects.toThrow('already called')

      await expect(supermodules.renameSupermodule('sm_1', 'pump', { history })).resolves.toBe(true)
      commit()
      expect(flow.findNode('sm_1').data.supermodule.name).toBe('pump')
      expect(flow.findNode('dndnode_1').data.name).toBe('heart')
      expect(history.pointerIndex).toBe(1)
      await history.undo()
      expect(flow.findNode('sm_1').data.supermodule.name).toBe('heart')
    })

    it('deletes an unused super-module and its nodes as one undo step', async () => {
      const { smId, subsystemId } = supermodules.createEmptySubsystem('lung', { x: 0, y: 0 })
      flow.removeNodes([subsystemId])
      commit()
      expect(supermodules.find(smId).count).toBe(0)
      const steps = history.pointerIndex

      supermodules.deleteSupermodule(smId)
      commit()
      expect(flow.findNode(smId)).toBeUndefined()
      expect(history.pointerIndex).toBe(steps + 1)
      await history.undo()
      expect(flow.findNode(smId).hidden).toBe(true)
    })

    it('places another subsystem, but never one that would contain itself', () => {
      expect(supermodules.addSubsystem('sm_1', { x: 0, y: 0 })).toBe('dndnode_3')
      expect(flow.findNode('dndnode_3').data).toMatchObject({ name: 'heart_2', smId: 'sm_1' })
      expect(flow.findNode('dndnode_3').data.ports.map((p) => p.exposedPortId)).toEqual(['xp_in', 'xp_out'])
      expect(supermodules.find('sm_1')).toMatchObject({ count: 2, occurrences: 2 })

      level.enter('dndnode_1')
      expect(supermodules.canPlace('sm_1', 'sm_1')).toBe(false)
      expect(supermodules.addSubsystem('sm_1', { x: 0, y: 0 })).toBeNull()
    })
  })
})
