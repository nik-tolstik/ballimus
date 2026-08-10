import { describe, expect, it } from 'vitest'

import { localBrowserInitData } from './telegram'

describe('localBrowserInitData', () => {
  it('uses a fixture only in the Vite development runtime', () => {
    expect(localBrowserInitData({ DEV: true, VITE_LOCAL_OWNER_INIT_DATA: 'signed-local-fixture' })).toBe('signed-local-fixture')
    expect(localBrowserInitData({ DEV: false, VITE_LOCAL_OWNER_INIT_DATA: 'signed-local-fixture' })).toBeUndefined()
  })

  it('does not accept an empty fixture', () => {
    expect(localBrowserInitData({ DEV: true, VITE_LOCAL_OWNER_INIT_DATA: '' })).toBeUndefined()
  })
})
