import { afterEach, describe, expect, it, vi } from 'vitest'

import { createBrowserQueryPersistenceNotifications } from '../../app/query-persistence/notifications'

const sendStorageNotification = (value: string) =>
  globalThis.window.dispatchEvent(
    new StorageEvent('storage', {
      key: 'eve-space-esi-query-cache-invalidation-event',
      newValue: value,
    }),
  )

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

  it('retains a mixed-scope probe hint while rejecting malformed notification metadata', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    const notifications = createBrowserQueryPersistenceNotifications({ window: globalThis.window })
    const receive = vi.fn()
    notifications.subscribe(receive)
    sendStorageNotification(
      JSON.stringify({ generation: 2, scope: { kind: 'all' }, requiresScopeProbe: true }),
    )
    sendStorageNotification(
      JSON.stringify({ generation: 3, scope: { kind: 'all' }, requiresScopeProbe: false }),
    )
    expect(receive).toHaveBeenCalledOnce()
    expect(receive).toHaveBeenCalledWith({
      generation: 2,
      scope: { kind: 'all' },
      requiresScopeProbe: true,
    })
    notifications.dispose()
  })
})
