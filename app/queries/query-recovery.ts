import {
  isEsiPersistenceCoherent,
  isEsiPersistenceEligible,
} from '@eve-space/platform-module-nuxt/runtime'
import type { PiniaColadaPlugin, UseQueryEntry } from '@pinia/colada'
import { PUBLIC_QUERY_KEYS } from './query-keys'

type EsiServiceStatus = 'degraded' | 'operational' | 'stale' | 'unavailable'

export function installEsiQueryRecovery(): PiniaColadaPlugin {
  return ({ queryCache }) => {
    let previousEsiStatus: EsiServiceStatus | undefined

    queryCache.$onAction(({ name, args, after }) => {
      if (name !== 'fetch') {
        return
      }
      const entry = args[0] as UseQueryEntry
      if (!isSystemStatusEntry(entry)) {
        return
      }
      previousEsiStatus ??= readEsiServiceStatus(entry.state.value.data)

      after((state) => {
        if (state.status !== 'success') {
          return
        }
        const currentEsiStatus = readEsiServiceStatus(state.data)
        if (!currentEsiStatus) {
          return
        }
        const recovered = previousEsiStatus === 'unavailable' && currentEsiStatus === 'operational'
        previousEsiStatus = currentEsiStatus
        if (!recovered) {
          return
        }

        void queryCache
          .invalidateQueries({
            active: true,
            predicate: isRecoverableEsiEntry,
            stale: true,
          })
          .catch(() => {})
      })
    })
  }
}

function isSystemStatusEntry(entry: UseQueryEntry) {
  const key = PUBLIC_QUERY_KEYS.systemStatus()
  return entry.key.length === key.length && entry.key.every((part, index) => part === key[index])
}

function isRecoverableEsiEntry(entry: UseQueryEntry) {
  const persistence: unknown = entry.meta.esiPersistence
  return isEsiPersistenceEligible(persistence) && isEsiPersistenceCoherent(entry.key, persistence)
}

function readEsiServiceStatus(value: unknown): EsiServiceStatus | undefined {
  if (!isRecord(value) || !isRecord(value.telemetry)) {
    return undefined
  }
  const services = value.telemetry.services
  if (!isRecord(services) || !isRecord(services.esi)) {
    return undefined
  }
  const status = services.esi.status
  return status === 'degraded' ||
    status === 'operational' ||
    status === 'stale' ||
    status === 'unavailable'
    ? status
    : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
