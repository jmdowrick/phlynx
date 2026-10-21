import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { convertCelldl } = vi.hoisted(() => ({ convertCelldl: vi.fn() }))
vi.mock('../../../../src/services/celldl/convert.js', async (importActual) => ({ ...(await importActual()), convertCelldl }))

import { celldlImportNames, importCelldl } from '../../../../src/services/celldl/importCelldl.js'
import { useLibraryStore } from '../../../../src/stores/libraryStore.js'

const MATH = '<component name="rc"><variable name="x" units="dimensionless"/></component>'

describe('importCelldl', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
  })

  it('names a diagram apart from the units files the library has', () => {
    store.addUnitsFile({ componentFile: 'rc.cellml', model: '<model/>' })
    expect(celldlImportNames('rc.celldl', store)).toEqual({
      componentName: 'rc_1',
      cellmlFile: 'rc_1.cellml',
      mathRef: 'rc_1.cellml:rc_1',
    })
    expect(celldlImportNames('2 pools.CELLDL', store).componentName).toBe('_2_pools')
  })

  it('adds nothing when the CellML has no component of the name asked for', async () => {
    convertCelldl.mockResolvedValueOnce({
      ok: true,
      components: [{ name: 'other', math: MATH }],
      errors: [],
      warnings: [],
    })

    const result = await importCelldl('rc.celldl', '<svg/>', store)

    expect(result).toMatchObject({ ok: false, errors: [expect.objectContaining({ message: expect.stringContaining('rc') })] })
    expect(store.getMathSource('rc.cellml:rc')).toBeNull()
    expect(store.availableMath.size).toBe(0)
  })
})
