// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import NewSupermoduleDialog from '../../../src/components/dialogs/NewSupermoduleDialog.vue'
import { useCanvasLevel } from '../../../src/composables/useCanvasLevel.js'
import { FLOW_IDS } from '../../../src/utils/constants.js'
import { module, supermodule } from '../fixtures/hierarchy/graph.js'

describe('NewSupermoduleDialog', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const level = useCanvasLevel()
  let wrapper

  /** Mounts the dialog open, its content kept in place rather than teleported. */
  async function mountDialog(props = {}) {
    wrapper = mount(NewSupermoduleDialog, {
      props: { modelValue: true, ...props },
      global: { plugins: [PrimeVue], stubs: { teleport: true } },
    })
    await nextTick()
  }
  const input = () => wrapper.find('#new-supermodule-name')
  const hint = () => wrapper.find('#new-supermodule-hint')
  const createButton = () => wrapper.findAll('button').find((button) => button.text() === 'Create')

  beforeEach(async () => {
    setActivePinia(createPinia())
    level.reset()
    // `supermodule` is taken on the canvas, `supermodule_2` by a super-module.
    await flow.fromObject({ nodes: [module('dndnode_0', 'supermodule'), supermodule('sm_1', 'supermodule_2')], edges: [] })
  })
  afterEach(() => wrapper?.unmount())

  it('offers a name nothing on the canvas or among super-modules has', async () => {
    await mountDialog()
    expect(input().element.value).toBe('supermodule_3')
    expect(hint().text()).toContain('Makes a super-module and one super instance of it')
  })

  it('refuses a name the rules for names inside super-modules don’t allow, or one taken', async () => {
    await mountDialog()
    await input().setValue('a__b')
    expect(hint().text()).toContain('"__"')
    expect(createButton().attributes('disabled')).toBeDefined()

    await input().setValue('supermodule_2')
    expect(hint().text()).toBe('A super-module is already called "supermodule_2".')
    await createButton().trigger('click')
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('confirms the name as it will be kept, and closes', async () => {
    await mountDialog()
    await input().setValue('left heart')
    expect(hint().text()).toBe('Will be named left_heart.')
    await createButton().trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([['left_heart']])
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('renames a super-module, offering its own name and refusing another’s', async () => {
    await mountDialog({ mode: 'rename', smId: 'sm_1', initialName: 'supermodule_2' })
    expect(input().element.value).toBe('supermodule_2')
    expect(hint().text()).toBe('Its super instances keep their own names.')
    const rename = wrapper.findAll('button').find((button) => button.text() === 'Rename')
    // A canvas node's name doesn't count for a super-module renamed.
    await input().setValue('supermodule')
    expect(rename.attributes('disabled')).toBeUndefined()
    await rename.trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([['supermodule']])
  })

  it('names what a selection is nested into', async () => {
    await mountDialog({ mode: 'nest' })
    expect(wrapper.text()).toContain('Nest Selection')
    expect(wrapper.findAll('button').some((button) => button.text() === 'Nest')).toBe(true)
  })
})
