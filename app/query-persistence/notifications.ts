import { isInvalidationGeneration, type PrivateQueryInvalidationScope } from './envelope'
import { hasExactKeys, isExactRecord } from './shape'

const INVALIDATION_CHANNEL_NAME = 'eve-space-esi-query-cache-invalidation'
const INVALIDATION_STORAGE_KEY = 'eve-space-esi-query-cache-invalidation-event'

export interface QueryPersistenceNotification {
  readonly generation: number | null
  readonly scope: PrivateQueryInvalidationScope
}

export interface QueryPersistenceNotifications {
  dispose(): void
  publish(notification: QueryPersistenceNotification): void
  subscribe(receive: (notification: QueryPersistenceNotification) => void): () => void
}

export function createBrowserQueryPersistenceNotifications(
  options: {
    readonly broadcastChannel?: typeof BroadcastChannel
    readonly window?: Window
  } = {},
): QueryPersistenceNotifications {
  const browserWindow = options.window ?? globalThis.window
  const BroadcastChannelConstructor = options.broadcastChannel ?? globalThis.BroadcastChannel
  const subscriptions = new Set<(notification: QueryPersistenceNotification) => void>()
  let disposed = false

  const receive = (value: unknown) => {
    const notification = parseInvalidationNotification(value)
    if (!notification || disposed) return
    for (const subscription of subscriptions) subscription(notification)
  }

  if (BroadcastChannelConstructor !== undefined) {
    const channel = new BroadcastChannelConstructor(INVALIDATION_CHANNEL_NAME)
    const onMessage = (event: MessageEvent<unknown>) => receive(event.data)
    channel.addEventListener('message', onMessage)
    return {
      dispose() {
        if (disposed) return
        disposed = true
        subscriptions.clear()
        channel.removeEventListener('message', onMessage)
        channel.close()
      },
      publish(notification) {
        if (!disposed) {
          Reflect.apply(BroadcastChannelConstructor.prototype.postMessage, channel, [notification])
        }
      },
      subscribe(subscription) {
        if (disposed) return () => undefined
        subscriptions.add(subscription)
        return () => subscriptions.delete(subscription)
      },
    }
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== INVALIDATION_STORAGE_KEY || event.newValue === null) return
    try {
      receive(JSON.parse(event.newValue))
    } catch {
      return
    }
  }
  browserWindow?.addEventListener('storage', onStorage)
  return {
    dispose() {
      if (disposed) return
      disposed = true
      subscriptions.clear()
      browserWindow?.removeEventListener('storage', onStorage)
    },
    publish(notification) {
      if (disposed) return
      try {
        browserWindow?.localStorage.removeItem(INVALIDATION_STORAGE_KEY)
        browserWindow?.localStorage.setItem(INVALIDATION_STORAGE_KEY, JSON.stringify(notification))
      } catch {
        return
      }
    },
    subscribe(subscription) {
      if (disposed) return () => undefined
      subscriptions.add(subscription)
      return () => subscriptions.delete(subscription)
    },
  }
}

export function createSilentQueryPersistenceNotifications(): QueryPersistenceNotifications {
  return {
    dispose() {},
    publish() {},
    subscribe: () => () => undefined,
  }
}

function parseInvalidationNotification(value: unknown): QueryPersistenceNotification | null {
  if (
    !isExactRecord(value, ['generation', 'scope']) ||
    (value.generation !== null && !isInvalidationGeneration(value.generation))
  ) {
    return null
  }
  const scope = parseInvalidationScope(value.scope)
  return scope ? { generation: value.generation, scope } : null
}

function parseInvalidationScope(value: unknown): PrivateQueryInvalidationScope | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.kind === 'all' && hasExactKeys(record, ['kind'])) return { kind: 'all' }
  if (record.kind === 'character') {
    if (hasExactKeys(record, ['kind'])) return { kind: 'character' }
    if (
      hasExactKeys(record, ['kind', 'characterId']) &&
      typeof record.characterId === 'number' &&
      Number.isSafeInteger(record.characterId) &&
      record.characterId > 0
    ) {
      return { kind: 'character', characterId: record.characterId }
    }
  }
  if (record.kind === 'organization') {
    if (hasExactKeys(record, ['kind'])) return { kind: 'organization' }
    if (
      hasExactKeys(record, ['kind', 'admissionScope']) &&
      typeof record.admissionScope === 'string' &&
      record.admissionScope.length > 0
    ) {
      return { kind: 'organization', admissionScope: record.admissionScope }
    }
  }
  return null
}
