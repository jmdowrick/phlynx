// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it, vi } from 'vitest'

const exposure = vi.hoisted(() => ({
  exposedPortListOf: vi.fn(() => [
    { id: 'xp_1', label: null, childId: 'a', childName: 'lv', port: { label: 'vessel', portType: 'entrance_ports', variables: ['v_in'] } },
    { id: 'xp_2', label: 'outlet', childId: 'b', childName: 'ra', port: { label: 'vessel', portType: 'exit_ports', variables: ['v'] } },
    { id: 'xp_3', label: null, ownLabel: 'gone', childId: 'c', childName: 'x', port: null },
  ]),
  reorderExposedPorts: vi.fn(),
  relabelExposedPort: vi.fn(),
  unexposePorts: vi.fn(),
}))
const confirm = vi.hoisted(() => vi.fn())
vi.mock('../../../src/composables/useExposure', () => ({ useExposure: () => exposure }))
vi.mock('../../../src/composables/useConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm }) }))
vi.mock('../../../src/composables/useHandleManagement', () => ({ useHandleManagement: () => ({}) }))

const { default: ExposedPortList } = await import('../../../src/components/ExposedPortList.vue')

let wrapper
afterEach(() => wrapper?.unmount())

const button = (label) => wrapper.find(`[aria-label="${label}"]`)

describe('ExposedPortList', () => {
  it('lists a super-module’s exposed ports in order, flagging one that no longer resolves', () => {
    wrapper = mount(ExposedPortList, { props: { smId: 'sm_1' }, global: { plugins: [PrimeVue], directives: { tooltip: {} } } })
    const items = wrapper.findAll('[data-exposed-port]')
    expect(items.map((item) => item.attributes('data-exposed-port'))).toEqual(['xp_1', 'xp_2', 'xp_3'])
    expect(items[0].text()).toMatch(/lv\s+· entrance_ports · v_in/)
    expect(items[2].classes()).toContain('exposed-port--unresolved')
    expect(button('Move vessel up').attributes('disabled')).toBeDefined()
  })

  it('reorders, relabels and un-exposes, asking before un-exposing', async () => {
    wrapper = mount(ExposedPortList, { props: { smId: 'sm_1' }, global: { plugins: [PrimeVue], directives: { tooltip: {} } } })
    await button('Move outlet up').trigger('click')
    expect(exposure.reorderExposedPorts).toHaveBeenCalledWith('sm_1', ['xp_2', 'xp_1', 'xp_3'])

    const input = button('Label of vessel')
    await input.setValue(' inlet ')
    await input.trigger('change')
    expect(exposure.relabelExposedPort).toHaveBeenCalledWith('sm_1', 'xp_1', 'inlet')

    await button('Un-expose outlet').trigger('click')
    expect(exposure.unexposePorts).toHaveBeenCalledWith('sm_1', ['xp_2'], { confirm })
  })
})
