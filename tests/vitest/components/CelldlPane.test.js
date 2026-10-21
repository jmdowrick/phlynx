import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed, nextTick, ref, shallowRef } from 'vue'
import PrimeVue from 'primevue/config'

/** Stands in for the live conversion, which the tests set the state of. */
const live = vi.hoisted(() => ({}))
vi.mock('../../../src/composables/useLiveCelldlConvert.js', () => ({ useLiveCelldlConvert: () => live }))

import CelldlPane from '../../../src/components/celldl/CelldlPane.vue'
import { useCelldlEditorHost } from '../../../src/composables/useCelldlEditorHost.js'

const ROWS = [{ name: 'v_1' }, { name: 'q_C' }]

function resetLive() {
  const latest = shallowRef(null)
  const result = computed(() => latest.value?.result ?? null)
  Object.assign(live, {
    isAvailable: true,
    error: ref(''),
    isPending: ref(false),
    isChecking: ref(false),
    latest,
    result,
    issues: computed(() => (result.value ? [...result.value.errors, ...result.value.warnings] : [])),
    start: vi.fn(async () => {}),
    setModule: vi.fn(),
  })
}

const converted = (pass, { errors = [], warnings = [], runnable, cellml = '<model name="rc"/>' } = {}) => ({
  pass,
  result: { cellml, errors, warnings, runnable },
})

describe('CelldlPane', () => {
  let wrapper

  beforeEach(resetLive)

  afterEach(() => {
    wrapper?.unmount()
  })

  const mountPane = (props = {}) => {
    wrapper = mount(CelldlPane, { props: { rows: ROWS, ...props }, global: { plugins: [PrimeVue] } })
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

  it("emits an element's own variable, as unsaved, for an element added since the save", () => {
    const host = mountPane()
    const annotation = { primary: 'q_X', variables: ['C_X', 'q_X'] }
    host.onViewerEvent({ type: 'select', component: { id: 'X', annotation } })
    expect(wrapper.emitted('variable-click')).toEqual([['q_X', { isUnsaved: true }]])
  })

  it('emits nothing for an element with no annotation, or for other events', () => {
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

describe('CelldlPane live conversion', () => {
  let wrapper

  beforeEach(resetLive)

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  const mountPane = (props = {}) => {
    wrapper = mount(CelldlPane, { props: { rows: ROWS, ...props }, global: { plugins: [PrimeVue] } })
  }
  const status = () => wrapper.find('.celldl-live-status')

  it('starts converting, for the module the dialog edits', async () => {
    mountPane({ componentName: 'rc', unitsFile: 'rc.cellml' })
    expect(live.start).toHaveBeenCalled()
    expect(live.setModule).toHaveBeenLastCalledWith({ componentName: 'rc', unitsFile: 'rc.cellml' })
    await wrapper.setProps({ componentName: 'rc_2' })
    expect(live.setModule).toHaveBeenLastCalledWith({ componentName: 'rc_2', unitsFile: 'rc.cellml' })
  })

  it('says it is converting until the latest diagram has a result', async () => {
    mountPane()
    expect(status().text()).toBe('Converting…')
    live.latest.value = converted('cheap')
    await nextTick()
    expect(status().text()).toBe('Converts')
    live.isPending.value = true
    await nextTick()
    expect(status().text()).toBe('Converting…')
  })

  it('says whether the checked model runs', async () => {
    mountPane()
    live.latest.value = converted('full', { runnable: true })
    await nextTick()
    expect(status().text()).toBe('Converts and runs')
    expect(status().attributes('title')).toBe('Checked with libCellML')
  })

  it('counts issues quietly, as save checks again', async () => {
    mountPane()
    live.latest.value = converted('full', {
      errors: [{ message: 'a' }, { message: 'b' }],
      warnings: [{ message: 'c' }],
    })
    await nextTick()
    expect(status().text()).toBe('3 issues, checked again on save')
    expect(wrapper.find('.celldl-live').attributes('data-state')).toBe('errors')
    live.latest.value = converted('cheap', { warnings: [{ message: 'c' }] })
    await nextTick()
    expect(status().text()).toBe('Converts, with 1 warning')
  })

  it('says when live conversion is off', async () => {
    live.error.value = 'no wasm'
    mountPane()
    expect(status().text()).toBe('Live conversion is unavailable')
    expect(status().attributes('title')).toBe('no wasm')
  })

  it('shows the CellML and its issues once opened', async () => {
    mountPane()
    expect(wrapper.find('.celldl-live-preview').exists()).toBe(false)
    live.latest.value = converted('cheap', { errors: [{ message: 'no template', elementId: 'X' }] })
    await wrapper.find('.celldl-live-toggle').trigger('click')
    expect(wrapper.find('.celldl-live-toggle').attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('.celldl-live-issues').text()).toContain('X: no template')
    expect(wrapper.find('.celldl-live-cellml').text()).toBe('<model name="rc"/>')
    await wrapper.find('.celldl-live-toggle').trigger('click')
    expect(wrapper.find('.celldl-live-preview').exists()).toBe(false)
  })

  it('shows nothing of it for a diagram that failed to open', async () => {
    mountPane()
    const host = useCelldlEditorHost()
    host.error.value = 'Cannot open'
    await nextTick()
    expect(wrapper.find('.celldl-live').exists()).toBe(false)
    host.error.value = ''
  })

  it('shows nothing of it where the build has no worker', () => {
    live.isAvailable = false
    mountPane()
    expect(wrapper.find('.celldl-live').exists()).toBe(false)
    expect(live.start).toHaveBeenCalled()
  })
})
