// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Checkbox from 'primevue/checkbox'
import { afterEach, describe, expect, it } from 'vitest'

import InstancePlotVariables from '../../../src/components/InstancePlotVariables.vue'

const ROWS = [
  { name: 'x', units: 'metre', type: 'variable', stateRole: 'state' },
  { name: 'xy', units: 'second', type: 'variable' },
  { name: 'k', units: 'per_second', type: 'constant' },
]

let wrapper
afterEach(() => wrapper?.unmount())

/**
 * Mounts the list with the given plotted variables.
 *
 * @param {Array<{name: string, groupId?: string|null}>} modelValue
 * @returns {import('@vue/test-utils').VueWrapper}
 */
function mountList(modelValue, initialEntries = []) {
  wrapper = mount(InstancePlotVariables, { props: { rows: ROWS, modelValue, initialEntries }, global: { plugins: [PrimeVue] } })
  return wrapper
}

// PrimeVue puts the label on the checkbox's input.
const checkboxLabelled = (label) => wrapper.findAllComponents(Checkbox).find((box) => box.find('input').attributes('aria-label') === label)
const rowCheckbox = (name) => checkboxLabelled(`Plot ${name}`)
const lastEmitted = () => wrapper.emitted('update:modelValue').at(-1)[0]

describe('InstancePlotVariables', () => {
  it('lists only the variables the instance computes', () => {
    mountList([])
    expect(rowCheckbox('x')).toBeDefined()
    expect(rowCheckbox('xy')).toBeDefined()
    expect(rowCheckbox('k')).toBeUndefined()
  })

  it('adds a ticked variable without a group, and removes an unticked one', async () => {
    mountList([{ name: 'x', groupId: 'plot-2' }])

    rowCheckbox('xy').vm.$emit('update:modelValue', true)
    expect(lastEmitted()).toEqual([{ name: 'x', groupId: 'plot-2' }, { name: 'xy' }])

    rowCheckbox('x').vm.$emit('update:modelValue', false)
    expect(lastEmitted()).toEqual([])
  })

  it('plots every variable the search shows, keeping existing groups', async () => {
    mountList([{ name: 'x', groupId: 'plot-2' }])
    await wrapper.find('input[type="text"]').setValue('x')

    checkboxLabelled('Plot all shown variables').vm.$emit('update:modelValue', true)

    expect(lastEmitted()).toEqual([{ name: 'x', groupId: 'plot-2' }, { name: 'xy' }])
  })

  it('gives a variable plotted again the group it had when the editor opened', () => {
    mountList([], [{ name: 'x', groupId: 'plot-2' }])

    rowCheckbox('x').vm.$emit('update:modelValue', true)
    expect(lastEmitted()).toEqual([{ name: 'x', groupId: 'plot-2' }])
  })

  it('counts only ticks on variables it lists', () => {
    mountList([{ name: 'x' }, { name: 'removed' }])
    expect(wrapper.find('.plot-summary').text()).toContain('1 of 2 plotted')
  })
})
