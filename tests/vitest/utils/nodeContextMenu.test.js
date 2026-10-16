import { describe, expect, it, vi } from 'vitest'

import { MAIN_NODE_TYPE, SUBSYSTEM_NODE_TYPE } from '../../../src/utils/constants.js'
import { nodeContextMenuItems } from '../../../src/utils/nodeContextMenu.js'

describe('nodeContextMenuItems', () => {
  const subsystemNode = { id: 'dndnode_1', type: SUBSYSTEM_NODE_TYPE, data: { smId: 'sm_1' } }
  const moduleNode = { id: 'dndnode_0', type: MAIN_NODE_TYPE, data: {} }
  const actions = () => ({
    open: vi.fn(),
    editSupermodule: vi.fn(),
    makeUnique: vi.fn(),
    unnest: vi.fn(),
    nest: vi.fn(),
    remove: vi.fn(),
    replace: vi.fn(),
    simulate: vi.fn(),
  })
  const build = (node, isEditingSupermodule = false, own = actions(), options = {}) =>
    nodeContextMenuItems({ node, isEditingSupermodule, simulateLabel: 'Simulate Instance', actions: own, ...options })
  const labels = (items) => items.map((item) => item.label)

  it('gives a subsystem Open, Edit Super-module, Make Unique, Un-nest, Simulate and Delete, each acting on it', () => {
    const own = actions()
    const items = build(subsystemNode, false, own, { canMakeUnique: true })
    expect(labels(items)).toEqual(['Open', 'Edit Super-module', 'Make Unique', 'Un-nest', 'Simulate Instance', 'Delete'])
    expect(items.some((item) => item.disabled)).toBe(false)
    items.forEach((item) => item.action())
    for (const name of ['open', 'editSupermodule', 'makeUnique', 'unnest', 'simulate', 'remove']) expect(own[name]).toHaveBeenCalledWith(subsystemNode)
    expect(own.replace).not.toHaveBeenCalled()
  })

  it('disables Make Unique when the super-module has no other copy', () => {
    const item = build(subsystemNode).find((entry) => entry.label === 'Make Unique')
    expect(item.disabled).toBe(true)
    expect(item.title).toMatch(/no other copy/)
  })

  it('offers Nest when given what it nests, on modules and subsystems alike', () => {
    const own = actions()
    expect(labels(build(moduleNode, false, own, { nestLabel: 'Nest Selection (2)' }))).toEqual(['Replace Module', 'Nest Selection (2)', 'Simulate Instance'])
    const items = build(subsystemNode, false, own, { nestLabel: 'Nest in Subsystem' })
    items.find((item) => item.label === 'Nest in Subsystem').action()
    expect(own.nest).toHaveBeenCalledWith(subsystemNode)
  })

  it('gives a module Replace Module and Simulate', () => {
    const own = actions()
    const items = build(moduleNode, false, own)
    expect(labels(items)).toEqual(['Replace Module', 'Simulate Instance'])
    items[0].action()
    expect(own.replace).toHaveBeenCalledWith(moduleNode)
  })

  it('has no Simulate while a super-module is edited on its own', () => {
    expect(labels(build(subsystemNode, true))).toEqual(['Open', 'Edit Super-module', 'Make Unique', 'Un-nest', 'Delete'])
    expect(labels(build(moduleNode, true))).toEqual(['Replace Module'])
  })
})
