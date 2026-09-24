import type { EntryKey } from '@pinia/colada'
import {
  computed,
  hasInjectionContext,
  inject,
  provide,
  type InjectionKey,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue'

export type EsiQueryPersistencePresentation =
  | {
      readonly kind: 'fresh'
      readonly originalSuccessAt?: string
    }
  | {
      readonly kind: 'restored'
      readonly originalSuccessAt: string
    }
  | {
      readonly kind: 'restored-refresh-failed'
      readonly originalSuccessAt: string
      readonly retryAt?: string
      readonly refreshFailureCode?: string
      readonly refreshFailureStatus?: number
    }
  | {
      readonly kind: 'server-stale'
      readonly originalSuccessAt?: string
      readonly validatedAt?: string
      readonly retryAt?: string
      readonly refreshFailureClass?: string
    }

export type PlatformQueryPersistenceReader = (
  key: MaybeRefOrGetter<EntryKey>,
) => Readonly<Ref<EsiQueryPersistencePresentation>>

const platformQueryPersistenceKey: InjectionKey<PlatformQueryPersistenceReader> = Symbol(
  'eve-space-platform-query-persistence',
)

export function providePlatformQueryPersistence(reader: PlatformQueryPersistenceReader) {
  provide(platformQueryPersistenceKey, reader)
}

export function usePlatformQueryPersistence(
  key: MaybeRefOrGetter<EntryKey>,
): Readonly<Ref<EsiQueryPersistencePresentation>> {
  const reader = hasInjectionContext() ? inject(platformQueryPersistenceKey) : undefined
  return reader?.(key) ?? computed(() => ({ kind: 'fresh' as const }))
}

export function selectEsiQueryPersistencePresentation(
  presentations: readonly EsiQueryPersistencePresentation[],
): EsiQueryPersistencePresentation {
  return presentations.reduce<EsiQueryPersistencePresentation>(
    (selected, candidate) =>
      presentationPriority(candidate) > presentationPriority(selected) ? candidate : selected,
    { kind: 'fresh' },
  )
}

function presentationPriority(presentation: EsiQueryPersistencePresentation) {
  if (presentation.kind === 'restored-refresh-failed') {
    return 3
  }
  if (presentation.kind === 'server-stale') {
    return 2
  }
  if (presentation.kind === 'restored') {
    return 1
  }
  return 0
}
