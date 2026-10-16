// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it } from 'vitest'

import CaIdentityDialog from '../../../src/components/dialogs/CaIdentityDialog.vue'
import { useCaIdentityPrompt } from '../../../src/composables/useCaIdentityPrompt.js'

describe('CaIdentityDialog', () => {
  const prompt = useCaIdentityPrompt()
  let wrapper

  /** Mounts the dialog, its content kept in place rather than teleported, and asks a question. */
  async function ask(request) {
    wrapper = mount(CaIdentityDialog, { global: { plugins: [PrimeVue], stubs: { teleport: true } } })
    const problemOf = ({ module_type }) => (module_type === 'taken' ? 'Another super-module here is taken:phlynx_v1.' : null)
    const answer = prompt.ask({ smId: 'sm_1', name: 'pump', reason: 'new', suggestion: { module_type: 'pump', module_subtype: 'phlynx_v1' }, ...request }, problemOf)
    await nextTick()
    return answer
  }
  const button = (label) => wrapper.findAll('button').find((b) => b.text() === label)
  afterEach(() => {
    if (prompt.question.value) prompt.answer(null)
    wrapper?.unmount()
  })

  it('offers the suggestion, and answers with the identity given', async () => {
    const answer = ask()
    await nextTick()
    expect(wrapper.find('#ca-identity-type').element.value).toBe('pump')
    expect(wrapper.find('#ca-identity-subtype').element.value).toBe('phlynx_v1')
    await wrapper.find('#ca-identity-subtype').setValue('v2')
    await button('Name').trigger('click')
    expect(await answer).toEqual({ module_type: 'pump', module_subtype: 'v2' })
  })

  it('refuses an identity with a problem, and answers null when exported flat', async () => {
    const answer = ask({ reason: 'changed', from: 'heart:Argus2026_v01' })
    await nextTick()
    expect(wrapper.text()).toContain('no longer matches library super-module heart:Argus2026_v01')
    await wrapper.find('#ca-identity-type').setValue('taken')
    expect(wrapper.find('#ca-identity-hint').text()).toBe('Another super-module here is taken:phlynx_v1.')
    expect(button('Name').attributes('disabled')).toBeDefined()
    await button('Export flat').trigger('click')
    expect(await answer).toBeNull()
  })
})
