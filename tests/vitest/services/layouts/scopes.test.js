import { describe, expect, it, vi } from 'vitest'

const runFcoseLayout = vi.hoisted(() => vi.fn(async (nodes) => nodes.forEach((node) => (node.position = { x: 9, y: 9 }))))
vi.mock('../../../../src/services/layouts/cytoscape', () => ({ runFcoseLayout }))

const { layoutSupermoduleScopes } = await import('../../../../src/services/layouts/scopes.js')

describe('layoutSupermoduleScopes', () => {
  it("lays out each super-module's scope but those kept, and never the root", async () => {
    const node = (id, scope) => ({ id, position: { x: 0, y: 0 }, data: { scope } })
    const nodes = [node('a', null), node('sm_1', 'sm_1'), node('sm_1~b', 'sm_1'), node('sm_2', 'sm_2'), node('sm_2~c', 'sm_2')]
    await layoutSupermoduleScopes(nodes, [], { keep: new Set(['sm_2']) })
    expect(nodes.map((n) => [n.id, n.position.x])).toEqual([['a', 0], ['sm_1', 9], ['sm_1~b', 9], ['sm_2', 0], ['sm_2~c', 0]])
    expect(runFcoseLayout).toHaveBeenCalledTimes(1)
  })
})
