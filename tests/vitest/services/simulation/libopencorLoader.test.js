import { afterEach, describe, expect, it, vi } from 'vitest'

import { libopencor, loadLibOpenCOR, resetLibOpenCORLoader, whenLibOpenCORReady } from '../../../../src/services/simulation/libopencorLoader.js'

const ISOLATED = { crossOriginIsolated: true }
const NOT_ISOLATED = { crossOriginIsolated: false, isSecureContext: true, navigator: {} }

/**
 * Stands in for importing the glue module: its factory resolves to a fake libOpenCOR.
 *
 * @param {Function} [createModule]
 * @returns {Function}
 */
const fakeImport = (createModule = vi.fn(async () => ({ versionString: () => '1.2.3' }))) => vi.fn(async () => ({ default: createModule }))

describe('loadLibOpenCOR', () => {
  afterEach(() => resetLibOpenCORLoader())

  it('loads the glue from where the build serves it, and reports ready', async () => {
    const createModule = vi.fn(async () => ({ versionString: () => '1.2.3' }))
    const importModule = fakeImport(createModule)

    const promise = loadLibOpenCOR({ scope: ISOLATED, importModule })
    expect(libopencor.status).toBe('loading')
    const module = await promise

    expect(importModule).toHaveBeenCalledWith(expect.stringMatching(/^\/libopencor\/[\d.]+\/libopencor\.js$/))
    const { locateFile } = createModule.mock.calls[0][0]
    expect(locateFile('libopencor.wasm')).toMatch(/^\/libopencor\/[\d.]+\/libopencor\.wasm$/)
    expect(module.versionString()).toBe('1.2.3')
    expect({ ...libopencor }).toEqual({ status: 'ready', reason: null, versionString: '1.2.3' })
  })

  it('loads once, however often it is asked', async () => {
    const importModule = fakeImport()
    const first = loadLibOpenCOR({ scope: ISOLATED, importModule })

    expect(loadLibOpenCOR({ scope: ISOLATED, importModule })).toBe(first)
    expect(whenLibOpenCORReady()).toBe(first)
    await first
    expect(importModule).toHaveBeenCalledTimes(1)
  })

  it('reports why it can’t load in a page that isn’t isolated, without downloading', async () => {
    const importModule = fakeImport()

    expect(await loadLibOpenCOR({ scope: NOT_ISOLATED, importModule })).toBeNull()

    expect(importModule).not.toHaveBeenCalled()
    expect(libopencor.status).toBe('unavailable')
    expect(libopencor.reason).toMatch(/service workers/)
  })

  it('reports a failed load', async () => {
    const importModule = vi.fn(async () => {
      throw new Error('Failed to fetch')
    })

    expect(await loadLibOpenCOR({ scope: ISOLATED, importModule })).toBeNull()
    expect({ ...libopencor }).toEqual({ status: 'error', reason: 'Failed to fetch', versionString: null })
  })
})
