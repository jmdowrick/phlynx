// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { exposed, module, port, supermodule } from '../fixtures/hierarchy/graph.js'

const IN = port('entrance_ports', 'vessel', ['v_in'])
const ra = module('ra', 'ra', { scope: 'sm_1', ports: [{ ...IN }] })
const sm = supermodule('sm_1', 'heart')
const nodes = new Map([ra, sm].map((node) => [node.id, node]))

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  BaseEdge: { name: 'BaseEdge', template: '<path class="base-edge-stub" />' },
  EdgeLabelRenderer: { name: 'EdgeLabelRenderer', template: '<div class="label-renderer"><slot /></div>' },
  useVueFlow: () => ({ findNode: (id) => nodes.get(id) }),
}))

const { default: ExposureEdge } = await import('../../../src/components/ExposureEdge.vue')

const mountEdge = (exposedEntries) =>
  mount(ExposureEdge, {
    props: {
      id: 'x1',
      source: ra.id,
      target: sm.id,
      sourceX: 0,
      sourceY: 0,
      targetX: 100,
      targetY: 0,
      sourcePosition: 'right',
      targetPosition: 'left',
      data: { exposed: exposedEntries },
    },
    attachTo: document.createElementNS('http://www.w3.org/2000/svg', 'g'),
  })

describe('ExposureEdge', () => {
  it('marks an edge that exposes nothing, with no title', () => {
    const wrapper = mountEdge([])
    expect(wrapper.find('.exposure-edge-label').text()).toBe('Nothing exposed')
    expect(wrapper.find('title').exists()).toBe(false)
  })

  it('has no label once it exposes something, its title listing "child · port" first', () => {
    const wrapper = mountEdge([exposed('xp_in', 'ra', 'entrance_ports', 'vessel')])
    expect(wrapper.find('.exposure-edge-label').exists()).toBe(false)
    expect(wrapper.find('title').text()).toBe('ra · vessel')
    expect(wrapper.html().indexOf('<title')).toBeLessThan(wrapper.html().indexOf('base-edge-stub'))
  })
})
