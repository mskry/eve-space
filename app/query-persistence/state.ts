import type { QueryCache } from '@pinia/colada'
import { shallowRef, type ShallowRef } from 'vue'
import { createQueryPersistenceEntryState, type QueryPersistenceEntryState } from './entry-state'
import type { EsiQueryCacheEnvelope, PersistedQueryCache } from './envelope'

export interface QueryPersistenceRuntimeState {
  readonly queryCache: QueryCache
  readonly entryState: QueryPersistenceEntryState
  envelope: EsiQueryCacheEnvelope
  readonly hydrationReady: Promise<void>
  hydrationFinished: boolean
  officialPersisterInstalled: boolean
  pendingPublicHydration: PersistedQueryCache
  presentationRevision: ShallowRef<number>
  retainedDataExpiryTimer: ReturnType<typeof setTimeout> | undefined
  readonly resolveHydration: () => void
  readonly resolveRestoration: () => void
  readonly restorationReady: Promise<void>
  restorationSettled: boolean
}

export function createQueryPersistenceState(
  queryCache: QueryCache,
  envelope: EsiQueryCacheEnvelope,
): QueryPersistenceRuntimeState {
  const hydration = deferred()
  const restoration = deferred()
  return {
    queryCache,
    entryState: createQueryPersistenceEntryState(),
    envelope,
    hydrationReady: hydration.promise,
    hydrationFinished: false,
    officialPersisterInstalled: false,
    pendingPublicHydration: {},
    presentationRevision: shallowRef(0),
    retainedDataExpiryTimer: undefined,
    resolveHydration: hydration.resolve,
    resolveRestoration: restoration.resolve,
    restorationReady: restoration.promise,
    restorationSettled: false,
  }
}

export function touchQueryPersistenceState(state: QueryPersistenceRuntimeState) {
  state.presentationRevision.value += 1
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}
