import { afterEach, describe, expect, it, vi } from 'vitest'

import { createBrowserQueryPersistenceNotifications } from '../../app/query-persistence/notifications'

describe('query persistence notifications', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('re-publishes identical fail-closed notifications through local storage', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    const removeItem = vi.fn()
    const setItem = vi.fn()
    const browserWindow = {
      addEventListener: vi.fn(),
      localStorage: { removeItem, setItem },
      removeEventListener: vi.fn(),
    }
    const notifications = createBrowserQueryPersistenceNotifications({ window: browserWindow })
    const notification = { generation: null, scope: { kind: 'all' } } as const

    notifications.publish(notification)
    notifications.publish(notification)

    expect(removeItem).toHaveBeenCalledTimes(2)
    expect(setItem).toHaveBeenCalledTimes(2)
    notifications.dispose()
  })
})
