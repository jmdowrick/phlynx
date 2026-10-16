import { describe, expect, it } from 'vitest'

import { checkResourcesAreLoaded } from '../../../src/utils/import.js'

describe('checkResourcesAreLoaded', () => {
  const store = (modules, variants, math) => ({ availableModules: new Map(modules), caVariants: new Map(variants), availableMath: new Set(math) })
  const variant = ['arterial_simple:vp__abcdefgh', { moduleRef: 'arterial_simple:vp__abcdefgh', mathRef: 'User_modules.cellml:copy_type' }]

  it("finds a module ref among the CA export's variants kept aside from the library, and checks its math", () => {
    const rows = [{ module_type: 'arterial_simple', module_subtype: 'vp__abcdefgh' }]
    expect(checkResourcesAreLoaded(rows, store([], [variant], ['User_modules.cellml:copy_type'])).resourcesAreLoaded).toBe(true)

    const missing = checkResourcesAreLoaded(rows, store([], [variant], []))
    expect(missing.resourcesAreLoaded).toBe(false)
    expect([...missing.missingResources.math]).toEqual(['User_modules.cellml:copy_type'])
  })

  it('reports a module ref neither the library nor the variants hold', () => {
    const result = checkResourcesAreLoaded([{ module_type: 'arterial_simple', module_subtype: 'vp__zzzzzzzz' }], store([], [variant], []))
    expect([...result.missingResources.modules]).toEqual(['arterial_simple:vp__zzzzzzzz'])
  })
})

describe('checkResourcesAreLoaded with super-modules', () => {
  const rec = (name, module_type, module_subtype, extra = {}) => ({ name, module_type, module_subtype, ...extra })
  const heart = {
    moduleRef: 'heart:v1',
    module_type: 'heart',
    module_subtype: 'v1',
    submodules: [rec('ra', 'chamber', 'v'), rec('aov', 'valve', 'pp'), rec('pace', 'pacer', 's')],
  }
  const pacer = { moduleRef: 'pacer:s', module_type: 'pacer', module_subtype: 's', submodules: [rec('clock', 'clock', 'c')] }
  const store = (modules, supermodules, math = []) => ({
    availableModules: new Map(modules.map(([ref, mathRef]) => [ref, { moduleRef: ref, mathRef }])),
    availableMath: new Set(math),
    availableSupermodules: new Map(supermodules.map((t) => [t.moduleRef, t])),
  })

  it("asks for the leaves' configs and CellML, through nested super-modules, not for the super-module itself", () => {
    const rows = [rec('heart', 'heart', 'v1'), rec('svc', 'venous', 'vp')]
    const status = checkResourcesAreLoaded(rows, store([['valve:pp', 'valve.cellml:valve'], ['venous:vp', 'v.cellml:venous']], [heart, pacer], ['v.cellml:venous']))
    expect([...status.missingResources.modules]).toEqual(['chamber:v', 'clock:c'])
    expect([...status.missingResources.math]).toEqual(['valve.cellml:valve'])
  })

  it('refuses, for now, a module array that instantiates a super-module, known or not', () => {
    const loaded = store([['chamber:v', 'c:c'], ['valve:pp', 'c:c'], ['clock:c', 'c:c']], [heart, pacer], ['c:c'])
    const status = checkResourcesAreLoaded([rec('heart', 'heart', 'v1')], loaded)
    expect(status.warnings).toEqual([])
    expect(status.resourcesAreLoaded).toBe(false)
    expect(status.supermoduleInstances).toEqual(['heart (heart:v1)'])
    expect(status.errors[0]).toContain('supported in the next step')

    const unknown = rec('neuron', 'neuron', 'sym', { per_submodule_inputs: { soma: ['x'] } })
    expect(checkResourcesAreLoaded([unknown], store([], [])).supermoduleInstances).toEqual(['neuron (neuron:sym)'])
  })

  it('reports staging errors and nesting cycles without looping', () => {
    const loopA = { moduleRef: 'a:s', submodules: [rec('b', 'b', 's')] }
    const loopB = { moduleRef: 'b:s', submodules: [rec('a', 'a', 's')] }
    const status = checkResourcesAreLoaded([rec('x', 'a', 's')], { ...store([], [loopA, loopB]), supermoduleErrors: ['clash'] })
    expect(status.errors.slice(0, 2)).toEqual(['clash', 'Supermodules nest in a cycle (a/s -> b/s -> a/s).'])
  })
})
