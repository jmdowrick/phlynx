// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import NewSubsystemDialog from '../../../src/components/dialogs/NewSubsystemDialog.vue'
import { useCanvasLevel } from '../../../src/composables/useCanvasLevel.js'
import { FLOW_IDS } from '../../../src/utils/constants.js'
import { module, supermodule } from '../fixtures/hierarchy/graph.js'

describe('NewSubsystemDialog', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const level = useCanvasLevel()
  let wrapper

  /** Mounts the dialog open, its content kept in place rather than teleported. */
  async function mountDialog() {
    wrapper = mount(NewSubsystemDialog, {
      props: { modelValue: true },
      global: { plugins: [PrimeVue], stubs: { teleport: true } },
    })
    await nextTick()
  }
  const input = () => wrapper.find('#new-subsystem-name')
  const hint = () => wrapper.find('#new-subsystem-hint')
  const createButton = () => wrapper.findAll('button').find((button) => button.text() === 'Create')

  beforeEach(async () => {
    setActivePinia(createPinia())
    level.reset()
    // `subsystem` is taken on the canvas, `subsystem_2` by a super-module.
    await flow.fromObject({ nodes: [module('dndnode_0', 'subsystem'), supermodule('sm_1', 'subsystem_2')], edges: [] })
  })
  afterEach(() => wrapper?.unmount())

  it('offers a name nothing on the canvas or among super-modules has', async () => {
    await mountDialog()
    expect(input().element.value).toBe('subsystem_3')
    expect(hint().text()).toContain('Makes a super-module and one subsystem of it')
  })

  it('refuses a name the rules for names inside super-modules don’t allow, or one taken', async () => {
    await mountDialog()
    await input().setValue('a__b')
    expect(hint().text()).toContain('"__"')
    expect(createButton().attributes('disabled')).toBeDefined()

    await input().setValue('subsystem_2')
    expect(hint().text()).toBe('A super-module is already called "subsystem_2".')
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
})
