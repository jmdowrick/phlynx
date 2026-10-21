import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'

import CelldlPane from '../../../src/components/celldl/CelldlPane.vue'
import { useCelldlEditorHost } from '../../../src/composables/useCelldlEditorHost.js'

const ROWS = [{ name: 'v_1' }, { name: 'q_C' }]

describe('CelldlPane', () => {
  let wrapper

  afterEach(() => {
    wrapper?.unmount()
  })

  const mountPane = () => {
    wrapper = mount(CelldlPane, { props: { rows: ROWS }, global: { plugins: [PrimeVue] } })
    return useCelldlEditorHost()
  }

  it("emits a selected element's primary variable", () => {
    const host = mountPane()
    host.onViewerEvent({ type: 'select', component: { id: 'J', annotation: { primary: 'v_1', variables: ['v_1'] } } })
    expect(wrapper.emitted('variable-click')).toEqual([['v_1']])
  })

  it('falls back to the first of its variables the instance has', () => {
    const host = mountPane()
    host.onViewerEvent({ type: 'select', component: { id: 'C', annotation: { primary: 'C', variables: ['C', 'q_C'] } } })
    expect(wrapper.emitted('variable-click')).toEqual([['q_C']])
  })

  it('emits nothing for an element added since the save, or for other events', () => {
    const host = mountPane()
    host.onViewerEvent({ type: 'select', component: { id: 'new' } })
    host.onViewerEvent({ type: 'active', component: { id: 'J', annotation: { primary: 'v_1', variables: ['v_1'] } } })
    host.onViewerEvent({ type: 'unselect' })
    expect(wrapper.emitted('variable-click')).toBeUndefined()
  })

  it('stops hearing the editor once unmounted', () => {
    const host = mountPane()
    wrapper.unmount()
    host.onViewerEvent({ type: 'select', component: { id: 'J', annotation: { primary: 'v_1' } } })
    expect(wrapper.emitted('variable-click')).toBeUndefined()
    wrapper = null
  })
})
