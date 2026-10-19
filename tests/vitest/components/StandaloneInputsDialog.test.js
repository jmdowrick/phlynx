// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it } from 'vitest'

import StandaloneInputsDialog from '../../../src/components/dialogs/StandaloneInputsDialog.vue'
import { useStandaloneInputsPrompt } from '../../../src/composables/useStandaloneInputsPrompt.js'

const FOLDERS = [
  { folder: 'modules/tank/instances/h0/', name: 'h0', kind: 'module', path: 'h0', inputs: [{ id: 'modules/tank/instances/h0/v_sum', label: 'v_sum', units: 'per_second' }] },
  {
    folder: 'supermodules/organ/instances/o1/',
    name: 'o1',
    kind: 'super',
    path: 'o1',
    inputs: [
      { id: 'supermodules/organ/instances/o1/u_leaf_c1', label: 'c1/leaf.u', units: 'dimensionless' },
      { id: 'supermodules/organ/instances/o1/u_leaf_c2', label: 'c2/leaf.u', units: 'dimensionless' },
    ],
  },
]

describe('StandaloneInputsDialog', () => {
  const prompt = useStandaloneInputsPrompt()
  let wrapper

  /** Mounts the dialog, its content kept in place rather than teleported, and asks for the folders' inputs. */
  async function ask(values) {
    wrapper = mount(StandaloneInputsDialog, { global: { plugins: [PrimeVue], stubs: { teleport: true } } })
    const answer = prompt.ask(FOLDERS, values)
    await nextTick()
    await nextTick()
    return answer
  }
  const button = (label) => wrapper.findAll('button').find((b) => b.text() === label)
  const fields = () => wrapper.findAll('input')
  afterEach(() => {
    if (prompt.question.value) prompt.answer(null)
    wrapper?.unmount()
  })

  it('lists each instance’s inputs prefilled, and answers with the values given, blanks included', async () => {
    const answer = ask(new Map([[FOLDERS[0].inputs[0].id, '0.25'], [FOLDERS[1].inputs[0].id, '1']]))
    await nextTick()
    expect(wrapper.text()).toContain('c1/leaf.u')
    expect(wrapper.text()).toContain('super instance')
    expect(fields().map((field) => field.element.value)).toEqual(['0.25', '1', ''])
    expect(wrapper.text()).toContain('1 of 3 left blank.')
    await fields()[1].setValue(' 2 ')
    await button('Export').trigger('click')
    expect(await answer).toEqual(new Map([[FOLDERS[0].inputs[0].id, '0.25'], [FOLDERS[1].inputs[0].id, '2'], [FOLDERS[1].inputs[1].id, '']]))
  })

  it('refuses a value that is not a number, and answers null when cancelled', async () => {
    const answer = ask(new Map())
    await nextTick()
    // Number() reads '+3' and '0x10', but CellML doesn't.
    for (const value of ['abc', '+3', '0x10']) {
      await fields()[0].setValue(value)
      expect(wrapper.text(), value).toContain('Each value must be a number, or blank.')
      expect(button('Export').attributes('disabled'), value).toBeDefined()
    }
    await button('Cancel').trigger('click')
    expect(await answer).toBeNull()
  })
})
