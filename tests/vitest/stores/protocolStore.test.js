import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useOmexStore } from '../../../src/stores/omexStore.js'
import { useProtocolStore } from '../../../src/stores/protocolStore.js'

const PROTOCOL = { pre_times: [0], sim_times: [[1]], params_to_change: { 'a/k': [[2]] } }

/**
 * Gives the workspace's archive a file.
 *
 * @param {string} location
 * @param {string} text
 */
function addExtra(location, text) {
  useOmexStore().setArchive({ extras: [{ location, format: 'application/json', payload: new TextEncoder().encode(text).buffer }] })
}

describe('protocolStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it("reads the protocol of the archive's obs_data file", () => {
    const store = useProtocolStore()
    expect(store.hasProtocol).toBe(false)

    addExtra('model_obs_data.json', JSON.stringify({ protocol_info: PROTOCOL, data_items: [] }))
    expect(store.hasProtocol).toBe(true)
    expect(store.validation).toEqual({ errors: [], warnings: [] })
    expect(store.view.controls.map(({ parameter }) => parameter)).toEqual(['a/k'])
  })

  it('runs the protocol only once it is turned on, and signs it while it is', () => {
    addExtra('model_obs_data.json', JSON.stringify({ protocol_info: PROTOCOL }))
    const store = useProtocolStore()
    expect([store.isActive, store.signature]).toEqual([false, ''])

    store.isProtocolMode = true
    expect(store.isActive).toBe(true)
    expect(store.signature).not.toBe('')
    store.resetState()
    expect(store.isProtocolMode).toBe(false)
  })

  it("reports a protocol that can't run, and an obs_data file that isn't JSON", () => {
    const store = useProtocolStore()
    addExtra('model_obs_data.json', JSON.stringify({ protocol_info: { ...PROTOCOL, sim_times: [[0]] } }))
    expect(store.validation.errors).toEqual(['Experiment 1, sub-experiment 1 needs a length greater than 0.'])
    expect(store.view).toBeNull()

    addExtra('broken_obs_data.json', '{')
    expect(store.hasProtocol).toBe(false)
    expect(store.validation.errors[0]).toMatch(/^broken_obs_data.json isn't valid JSON: /)
  })
})
