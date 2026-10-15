import { describe, expect, it, vi } from 'vitest'

import { MAIN_NODE_TYPE, SUBSYSTEM_NODE_TYPE } from '../../../src/utils/constants.js'
import { nodeContextMenuItems } from '../../../src/utils/nodeContextMenu.js'

describe('nodeContextMenuItems', () => {
  const subsystemNode = { id: 'dndnode_1', type: SUBSYSTEM_NODE_TYPE, data: { smId: 'sm_1' } }
  const moduleNode = { id: 'dndnode_0', type: MAIN_NODE_TYPE, data: {} }
  const actions = () => ({ open: vi.fn(), editSupermodule: vi.fn(), remove: vi.fn(), replace: vi.fn(), simulate: vi.fn() })
  const build = (node, isEditingSupermodule = false, own = actions()) =>
    nodeContextMenuItems({ node, isEditingSupermodule, simulateLabel: 'Simulate Instance', actions: own })
  const labels = (items) => items.map((item) => item.label)

  it('gives a subsystem Open, Edit Super-module, Simulate and Delete, each acting on it', () => {
    const own = actions()
    const items = build(subsystemNode, false, own)
    expect(labels(items)).toEqual(['Open', 'Edit Super-module', 'Simulate Instance', 'Delete'])
    items.forEach((item) => item.action())
    for (const name of ['open', 'editSupermodule', 'simulate', 'remove']) expect(own[name]).toHaveBeenCalledWith(subsystemNode)
    expect(own.replace).not.toHaveBeenCalled()
  })

  it('gives a module Replace Module and Simulate', () => {
    const own = actions()
    const items = build(moduleNode, false, own)
    expect(labels(items)).toEqual(['Replace Module', 'Simulate Instance'])
    items[0].action()
    expect(own.replace).toHaveBeenCalledWith(moduleNode)
  })

  it('has no Simulate while a super-module is edited on its own', () => {
    expect(labels(build(subsystemNode, true))).toEqual(['Open', 'Edit Super-module', 'Delete'])
    expect(labels(build(moduleNode, true))).toEqual(['Replace Module'])
  })
})
