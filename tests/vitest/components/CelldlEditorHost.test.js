import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

const received = []
vi.mock('@celldl/editor', () => ({
  default: defineComponent({
    name: 'StubCellDLEditor',
    props: ['wheelMode', 'arrowStyle', 'unitSystem'],
    setup(props) {
      return () => {
        received.push(props.wheelMode)
        return h('div', { class: 'stub-editor', 'data-wheel-mode': props.wheelMode })
      }
    },
  }),
}))
vi.mock('@celldl/editor/style.css?inline', () => ({ default: '' }))

describe('CelldlEditorHost', () => {
  let wrapper
  afterEach(() => wrapper?.unmount())

  it('passes the scrolling setting to the editor as wheelMode, following changes', async () => {
    const { useAppSettings } = await import('../../../src/composables/useAppSettings')
    const { saveAppSettings } = useAppSettings()
    saveAppSettings({ celldlWheelMode: 'auto' })
    const { default: CelldlEditorHost } = await import('../../../src/components/celldl/CelldlEditorHost.vue')
    wrapper = mount(CelldlEditorHost, { attachTo: document.body })
    await vi.waitFor(async () => {
      await flushPromises()
      expect(document.querySelector('.stub-editor')).not.toBeNull()
    })
    expect(document.querySelector('.stub-editor').dataset.wheelMode).toBe('auto')

    saveAppSettings({ celldlWheelMode: 'zoom' })
    await flushPromises()
    expect(document.querySelector('.stub-editor').dataset.wheelMode).toBe('zoom')
    expect(received.at(-1)).toBe('zoom')
  })
})
