import { describe, expect, it } from 'vitest'

import { getIsolationStatus } from '../../../src/utils/isolation.js'

describe('getIsolationStatus', () => {
  it('reports an isolated page as ready', () => {
    expect(getIsolationStatus({ crossOriginIsolated: true })).toEqual({ isIsolated: true, reason: null })
  })

  it.each([
    ['an insecure page', { crossOriginIsolated: false, isSecureContext: false, navigator: {} }, /secure/],
    ['a window without service workers', { crossOriginIsolated: false, isSecureContext: true, navigator: {} }, /service workers/],
    ['a page the service worker hasn’t reloaded yet', { crossOriginIsolated: false, isSecureContext: true, navigator: { serviceWorker: {} } }, /Reload/],
  ])('says why %s isn’t isolated', (_, scope, reason) => {
    const status = getIsolationStatus(scope)
    expect(status.isIsolated).toBe(false)
    expect(status.reason).toMatch(reason)
  })
})
