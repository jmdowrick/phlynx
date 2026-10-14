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
