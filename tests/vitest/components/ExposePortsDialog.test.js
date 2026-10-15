// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it } from 'vitest'

import ExposePortsDialog from '../../../src/components/ExposePortsDialog.vue'

const port = (portType, label, variables, multiportType = 'None') => ({ portType, label, variables, multiportType })
const row = (key, p, { slot = 0, exposedPortId = null, label = null, order = null, disabled = false } = {}) => ({
  key,
  alias: { portType: p.portType, label: p.label, slot },
  port: p,
  slot,
  exposedPortId,
  label,
  order,
  disabled,
  reason: disabled ? 'Taken inside.' : null,
})

// lv: in (exposed second), out (exposed first, relabelled), two "flow" ports, the second taken inside.
const dialog = () => {
  const rows = [
    row('in', port('entrance_ports', 'vessel', ['v_in']), { exposedPortId: 'xp_2', order: 1 }),
    row('out', port('exit_ports', 'vessel', ['v']), { exposedPortId: 'xp_1', label: 'outlet', order: 0 }),
    row('f0', port('general_ports', 'flow', ['q'])),
    row('f1', port('general_ports', 'flow', ['q2']), { slot: 1, disabled: true }),
  ]
  return { child: { id: 'lv', data: { name: 'lv' } }, rows, selected: [rows[1], rows[0]] }
}

let wrapper
afterEach(() => wrapper?.unmount())

function mountDialog(props = {}) {
  wrapper = mount(ExposePortsDialog, {
    props: { modelValue: true, dialog: dialog(), ...props },
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: {} },
      stubs: { Dialog: { props: ['header'], template: '<div><h2>{{ header }}</h2><slot /><slot name="footer" /></div>' } },
    },
  })
}

const shownKeys = () => wrapper.vm.rows.map((r) => r.key)
const save = async () => {
  await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')
  return wrapper.emitted('save').at(-1)[0]
}

describe('ExposePortsDialog', () => {
  it('lists the child’s whole ports, exposed ones first in their order, ticked', () => {
    mountDialog()
    expect(wrapper.text()).toContain('Expose ports of lv')
    expect(shownKeys()).toEqual(['out', 'in', 'f0', 'f1'])
    expect(wrapper.vm.ticked).toEqual(['out', 'in'])
    expect(wrapper.text()).toContain('v_in')
    // Two ports alike are told apart by slot.
    expect(wrapper.text()).toContain('flow (1)')
    expect(wrapper.text()).toContain('flow (2)')
  })

  it('can’t tick a single-connection port already used inside', () => {
    mountDialog()
    const boxes = wrapper.findAll('input[type="checkbox"]')
    expect(boxes.at(3).attributes('disabled')).toBeDefined()
    expect(boxes.at(2).attributes('disabled')).toBeUndefined()
  })

  it('saves the ticked ports in the order shown, with their labels', async () => {
    mountDialog()
    wrapper.vm.ticked.push('f0')
    wrapper.vm.labels.f0 = '  side  '
    wrapper.vm.onRowReorder({ value: ['f0', 'out', 'in', 'f1'].map((key) => wrapper.vm.rows.find((r) => r.key === key)) })
    expect(await save()).toEqual([
      { key: 'f0', label: 'side' },
      { key: 'out', label: 'outlet' },
      { key: 'in', label: null },
    ])
  })

  it('un-exposes a port left unticked', async () => {
    mountDialog()
    wrapper.vm.ticked = ['in']
    expect(await save()).toEqual([{ key: 'in', label: null }])
  })

  it('shows why a save failed', () => {
    mountDialog({ problems: ['"flow" (slot 1) is exposed twice.'] })
    expect(wrapper.text()).toContain('is exposed twice')
  })
})
