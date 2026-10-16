// @vitest-environment happy-dom
import { useVueFlow } from '@vue-flow/core'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import FlowBreadcrumb from '../../../src/components/FlowBreadcrumb.vue'
import { useCanvasLevel } from '../../../src/composables/useCanvasLevel.js'
import { FLOW_IDS } from '../../../src/utils/constants.js'
import { module, subsystem, supermodule } from '../fixtures/hierarchy/graph.js'

/**
 * Root: three subsystems of heart (sm_1), which holds lv, a subsystem of chamber (sm_2), which holds a wall module.
 */
function graph() {
  const wall = module('dndnode_0', 'wall', { scope: 'sm_2' })
  const chamber = supermodule('sm_2', 'chamber')
  const lv = subsystem([chamber, wall], 'dndnode_0', 'lv', 'sm_2', { scope: 'sm_1' })
  const heart = supermodule('sm_1', 'heart', { ca: { module_type: 'heart', module_subtype: 'Argus2026_v01' } })
  const inner = [heart, lv, chamber, wall]
  const hearts = ['dndnode_1', 'dndnode_2', 'dndnode_3'].map((id, i) => subsystem(inner, id, `heart${i || ''}`, 'sm_1'))
  return { nodes: [...hearts, ...inner], edges: [] }
}

describe('FlowBreadcrumb', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const level = useCanvasLevel()
  let wrapper

  const mountCrumbs = (props = {}) => {
    wrapper = mount(FlowBreadcrumb, { props, attachTo: document.body })
  }
  const crumbTexts = () => wrapper.findAll('.crumb').map((crumb) => crumb.text().replace(/\s+/g, ' ').trim())
  const pressEscape = (target = document.body) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

  beforeEach(async () => {
    setActivePinia(createPinia())
    level.reset()
    await flow.fromObject(level.withVisibility(graph()))
  })
  afterEach(() => wrapper?.unmount())

  it('shows nothing at the root', () => {
    mountCrumbs()
    expect(wrapper.find('.flow-breadcrumb').exists()).toBe(false)
  })

  it('names each level: the subsystems entered, with their super-module and its subsystem count', async () => {
    mountCrumbs()
    level.enter('dndnode_1')
    level.enter('sm_1~dndnode_0')
    await wrapper.vm.$nextTick()
    expect(crumbTexts()).toEqual(['Model', 'heart (heart:Argus2026_v01 ×3)', 'lv (chamber)'])
  })

  it('makes every crumb but the current one a way back', async () => {
    mountCrumbs()
    level.enter('dndnode_1')
    level.enter('sm_1~dndnode_0')
    await wrapper.vm.$nextTick()

    const crumbs = wrapper.findAll('.crumb')
    expect(crumbs.map((crumb) => crumb.element.tagName)).toEqual(['BUTTON', 'BUTTON', 'SPAN'])
    expect(crumbs[2].attributes('aria-current')).toBe('location')
    await crumbs[2].trigger('click')
    expect(level.scope.value).toBe('sm_2')

    await crumbs[1].trigger('click')
    expect(level.scope.value).toBe('sm_1')
    await wrapper.find('.crumb').trigger('click')
    expect(level.isAtRoot.value).toBe(true)
  })

  it('follows a rename', async () => {
    mountCrumbs()
    level.enter('dndnode_1')
    flow.updateNodeData('dndnode_1', { name: 'pump' })
    await wrapper.vm.$nextTick()
    expect(crumbTexts()[1]).toBe('pump (heart:Argus2026_v01 ×3)')
  })

  it('goes up one level on Escape, but not from a field, past an open menu or while disabled', async () => {
    mountCrumbs()
    level.enter('dndnode_1')
    level.enter('sm_1~dndnode_0')

    const input = document.createElement('input')
    document.body.appendChild(input)
    pressEscape(input)
    expect(level.scope.value).toBe('sm_2')
    input.remove()

    await wrapper.setProps({ escapeDisabled: true })
    pressEscape()
    expect(level.scope.value).toBe('sm_2')

    await wrapper.setProps({ escapeDisabled: false })
    const menu = document.createElement('ul')
    menu.setAttribute('role', 'menu')
    document.body.appendChild(menu)
    pressEscape()
    expect(level.scope.value).toBe('sm_2')
    menu.remove()

    pressEscape()
    expect(level.scope.value).toBe('sm_1')
    pressEscape()
    expect(level.isAtRoot.value).toBe(true)
  })

  it('stays put on Escape while a confirm is open, though focus is on the canvas behind it', async () => {
    mountCrumbs()
    level.enter('dndnode_1')
    const node = document.createElement('div')
    node.tabIndex = 0
    document.body.appendChild(node)
    node.focus()
    const confirm = document.createElement('div')
    confirm.setAttribute('role', 'alertdialog')
    document.body.appendChild(confirm)

    pressEscape(node)
    expect(level.scope.value).toBe('sm_1')

    confirm.remove()
    pressEscape(node)
    expect(level.isAtRoot.value).toBe(true)
    node.remove()
  })

  it('warns that an edit changes every copy of a shared super-module', async () => {
    mountCrumbs()
    level.enter('dndnode_1')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.supermodule-banner').text()).toBe(
      "Editing super-module 'heart' — changes apply to 3 subsystems"
    )

    // chamber has one subsystem, but it is in heart, so the model has three copies of it.
    level.enter('sm_1~dndnode_0')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.supermodule-banner').text()).toContain("'chamber' — changes apply to 3 subsystems")
  })

  it('has no banner for a super-module with one copy, and marks one edited on its own', async () => {
    flow.removeNodes(['dndnode_2', 'dndnode_3'])
    mountCrumbs()
    level.editSupermodule('sm_1')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.supermodule-banner').exists()).toBe(false)
    expect(crumbTexts()).toEqual(['Model', 'heart (super-module)'])
  })
})
