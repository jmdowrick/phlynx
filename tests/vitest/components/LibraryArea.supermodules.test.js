// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import LibraryArea from '../../../src/components/LibraryArea.vue'
import { useCanvasLevel } from '../../../src/composables/useCanvasLevel.js'
import { FLOW_IDS } from '../../../src/utils/constants.js'
import { module, subsystem, supermodule } from '../fixtures/hierarchy/graph.js'

/** Root: two subsystems of heart (sm_1), which holds lv, a subsystem of chamber (sm_2). */
function graph() {
  const chamber = supermodule('sm_2', 'chamber')
  const wall = module('dndnode_0', 'wall', { scope: 'sm_2' })
  const lv = subsystem([chamber, wall], 'dndnode_0', 'lv', 'sm_2', { scope: 'sm_1' })
  const heart = supermodule('sm_1', 'heart', { ca: { module_type: 'heart', module_subtype: 'Argus2026_v01' } })
  const inner = [heart, lv, chamber, wall]
  return { nodes: [subsystem(inner, 'dndnode_1', 'left', 'sm_1'), subsystem(inner, 'dndnode_2', 'right', 'sm_1'), ...inner], edges: [] }
}

describe('LibraryArea super-modules', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const level = useCanvasLevel()
  let wrapper

  const mountLibrary = (props = { showSupermodules: true }) => {
    wrapper = mount(LibraryArea, { props, global: { plugins: [PrimeVue] } })
  }
  const cards = () => wrapper.findAll('.mlc__card--supermodule')
  const card = (smId) => wrapper.find(`[data-supermodule="${smId}"]`)

  beforeEach(async () => {
    setActivePinia(createPinia())
    level.reset()
    await flow.fromObject(level.withVisibility(graph()))
  })
  afterEach(() => wrapper?.unmount())

  it('lists the workspace’s super-modules with how many subsystems each has', () => {
    mountLibrary()
    expect(wrapper.find('.mlc__group--supermodules .mlc__group-name').text()).toBe('Super-modules')
    expect(cards().map((entry) => entry.find('.mlc__card-name').text())).toEqual(['heart', 'chamber'])
    expect(card('sm_1').find('.mlc__badge').text()).toBe('2 subsystems')
    expect(card('sm_1').find('.mlc__supermodule-label').text()).toBe('heart:Argus2026_v01')
    expect(card('sm_2').find('.mlc__badge').text()).toBe('1 subsystem')
  })

  it('lists none outside the workspace’s palette', () => {
    mountLibrary({})
    expect(cards()).toHaveLength(0)
    wrapper.unmount()
    mountLibrary({ showSupermodules: true, selectable: true })
    expect(cards()).toHaveLength(0)
  })

  it('edits a super-module on its own', async () => {
    mountLibrary()
    await card('sm_2').find('button').trigger('click')
    expect(level.isEditingSupermodule.value).toBe(true)
    expect(level.scope.value).toBe('sm_2')
  })

  it('drags a super-module to place another subsystem of it', async () => {
    mountLibrary()
    const data = new Map()
    const dataTransfer = { setData: (type, value) => data.set(type, value), effectAllowed: '' }
    await card('sm_1').trigger('dragstart', { dataTransfer })
    expect(data.get('application/vueflow')).toBe('sm_1')
    expect(card('sm_1').attributes('draggable')).toBe('true')
  })

  it('greys out a super-module that would contain itself here', async () => {
    mountLibrary()
    level.enter('dndnode_1')
    await nextTick()
    expect(card('sm_1').classes()).toContain('mlc__card--blocked')
    expect(card('sm_1').attributes('draggable')).toBe('false')
    expect(card('sm_2').classes()).not.toContain('mlc__card--blocked')

    // heart holds chamber, so inside chamber neither can go.
    level.editSupermodule('sm_2')
    await nextTick()
    expect(card('sm_1').classes()).toContain('mlc__card--blocked')
    expect(card('sm_2').classes()).toContain('mlc__card--blocked')

    const data = new Map()
    await card('sm_1').trigger('dragstart', { dataTransfer: { setData: (type, value) => data.set(type, value) } })
    expect(data.size).toBe(0)
  })

  it('filters by the search text', async () => {
    mountLibrary()
    await wrapper.find('.mlc__search input').setValue('argus')
    expect(cards().map((entry) => entry.attributes('data-supermodule'))).toEqual(['sm_1'])
  })
})
