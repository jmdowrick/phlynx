// @vitest-environment happy-dom
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nodes = ref([])
vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({ findNode: (id) => nodes.value.find((node) => node.id === id) }),
}))

const constants = vi.hoisted(() => ({
  candidatesOf: vi.fn(() => [{ name: 'R', units: 'J', value: '1', count: 2 }]),
  usageOf: vi.fn(() => []),
  nameProblemOf: vi.fn(() => null),
  declare: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))
const confirm = vi.hoisted(() => vi.fn())
vi.mock('../../../src/composables/useLocalConstants', () => ({ useLocalConstants: () => constants }))
vi.mock('../../../src/composables/useConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm }) }))

const { default: LocalConstantsPanel } = await import('../../../src/components/LocalConstantsPanel.vue')

let wrapper
afterEach(() => wrapper?.unmount())

const field = (label) => wrapper.find(`[aria-label="${label}"]`)
const mountPanel = () =>
  (wrapper = mount(LocalConstantsPanel, { props: { smId: 'sm_1' }, global: { plugins: [PrimeVue], directives: { tooltip: {} } } }))

describe('LocalConstantsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nodes.value = [{ id: 'sm_1', data: { supermodule: { name: 'segment', localConstants: [{ name: 'k', units: 's', value: '3' }] } } }]
  })

  it('lists the declared constants with their values and units, and edits a value as the default', async () => {
    mountPanel()
    const items = wrapper.findAll('[data-local-constant]')
    expect(items.map((item) => item.attributes('data-local-constant'))).toEqual(['k'])
    expect(items[0].text()).toContain('s')
    const input = field('Value of k')
    expect(input.element.value).toBe('3')
    await input.setValue('5')
    await input.trigger('change')
    expect(constants.update).toHaveBeenCalledWith('sm_1', 'k', { value: '5' })
  })

  it('declares a new one from a module constant, its units and value filled in, bound to the modules that have it', async () => {
    mountPanel()
    wrapper.vm.draft.name = 'R'
    wrapper.vm.onPickName()
    expect(wrapper.vm.draft).toMatchObject({ units: 'J', value: '1' })
    await flushPromises()
    expect(wrapper.text()).toContain('Use it for the 2 modules')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(constants.declare).toHaveBeenCalledWith('sm_1', { name: 'R', units: 'J', value: '1' }, { bind: true })
  })

  it('says why a name can’t be declared', async () => {
    constants.nameProblemOf.mockReturnValueOnce('"g" is a global constant.')
    mountPanel()
    wrapper.vm.draft.name = 'g'
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toBe('"g" is a global constant.')
    expect(constants.declare).not.toHaveBeenCalled()
  })

  it('asks before removing one in use, and removes an unused one at once', async () => {
    constants.usageOf.mockReturnValue([{ id: 'sm_1~p', data: { name: 'p' } }])
    confirm.mockResolvedValueOnce(false)
    mountPanel()
    await field('Remove k').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ header: 'Remove local constant?', message: expect.stringContaining('One module uses "k"') }))
    expect(constants.remove).not.toHaveBeenCalled()

    confirm.mockResolvedValueOnce(true)
    await field('Remove k').trigger('click')
    await flushPromises()
    expect(constants.remove).toHaveBeenCalledWith('sm_1', 'k')

    constants.usageOf.mockReturnValue([])
    confirm.mockClear()
    await field('Remove k').trigger('click')
    await flushPromises()
    expect(confirm).not.toHaveBeenCalled()
    expect(constants.remove).toHaveBeenCalledTimes(2)
  })
})
