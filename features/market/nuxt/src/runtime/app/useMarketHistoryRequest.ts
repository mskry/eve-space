import { ApiQueryError, readPlatformApiResponse } from '@eve-space/platform-module-nuxt/runtime'
import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'

export type MarketHistoryRequestStatus =
  | 'idle'
  | 'collecting'
  | 'queued'
  | 'waiting'
  | 'limit'
  | 'unavailable'
  | 'timed-out'

export interface MarketHistoryRequestTarget {
  profileId: string
  profileRevision: number
  typeId: number | null
  onDemand: boolean
}

interface MarketHistoryRequestOptions {
  target: Readonly<Ref<MarketHistoryRequestTarget>>
  active: Readonly<Ref<boolean>>
  uncollected: Readonly<Ref<boolean>>
  refetch: () => Promise<void>
  onReady?: (history: ReadyHistory) => void
}

type HistoryDemandResponse = Awaited<ReturnType<typeof postHistoryDemand>>
type ReadyHistory = Extract<HistoryDemandResponse, { status: 'ready' }>['history']
type MarketHistoryPendingPhase = 'queued' | 'collecting' | 'waiting'
type MarketHistoryRequested = {
  readonly phase: MarketHistoryPendingPhase
  readonly at: number
}

const pollIntervalMs = 4_000
const pollTimeoutMs = 90_000
const demandLimitCode = 'MARKET_HISTORY_DEMAND_LIMIT'

const identityOf = (target: MarketHistoryRequestTarget) =>
  `${target.profileId}:${target.profileRevision}:${target.typeId}`

// Requests start only from mounted client handlers, where Nuxt keeps its app context available.
const postHistoryDemand = async (current: MarketHistoryRequestTarget) => {
  const api = usePlatformApi()
  const response = await api.api.modules.market['history-intent'].profiles[':profileId'].types[
    ':typeId'
  ].demand.$post({
    param: { profileId: current.profileId, typeId: String(current.typeId) },
    json: {},
  })
  return readPlatformApiResponse(response, 'Daily history request is unavailable.')
}

const pendingPhaseOf = (response: HistoryDemandResponse): MarketHistoryPendingPhase =>
  response.status === 'accepted' ? response.phase : 'queued'

export const useMarketHistoryRequest = ({
  target,
  active,
  uncollected,
  refetch,
  onReady,
}: MarketHistoryRequestOptions) => {
  const status = ref<MarketHistoryRequestStatus>('idle')
  const requested = new Map<string, MarketHistoryRequested>()
  const pending = new Set<string>()
  const identity = computed(() => identityOf(target.value))
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let pollGeneration = 0
  let deadline = 0
  let mounted = false

  const isActiveTarget = (expected: string) =>
    mounted && active.value && expected === identity.value

  const stopPolling = () => {
    pollGeneration += 1
    clearTimeout(pollTimer)
    pollTimer = undefined
  }
  const currentRequest = (expected: string) => {
    const entry = requested.get(expected)
    if (entry && Date.now() - entry.at < pollTimeoutMs) return entry.phase
    requested.delete(expected)
    return undefined
  }
  const settleAfterRefresh = (expected: string): boolean => {
    if (!uncollected.value) {
      requested.delete(expected)
      status.value = 'idle'
      return true
    }
    if (Date.now() >= deadline) {
      status.value = 'timed-out'
      return true
    }
    return false
  }
  const schedulePoll = (expected: string) => {
    const generation = pollGeneration
    pollTimer = setTimeout(async () => {
      if (generation !== pollGeneration || !isActiveTarget(expected)) return
      await refetch().catch(() => undefined)
      if (
        generation !== pollGeneration ||
        !isActiveTarget(expected) ||
        settleAfterRefresh(expected)
      )
        return
      schedulePoll(expected)
    }, pollIntervalMs)
  }
  const startCollecting = (expected: string, phase: MarketHistoryPendingPhase) => {
    stopPolling()
    deadline = Date.now() + pollTimeoutMs
    status.value = phase
    schedulePoll(expected)
  }
  const refreshCollection = async (
    expected: string,
    phase: MarketHistoryPendingPhase = 'queued',
  ) => {
    const generation = pollGeneration
    if (!isActiveTarget(expected)) return
    await refetch().catch(() => undefined)
    if (generation !== pollGeneration || !isActiveTarget(expected)) return
    if (uncollected.value) {
      startCollecting(expected, phase)
      return
    }
    requested.delete(expected)
    status.value = 'idle'
  }
  const rememberResponse = (expected: string, response: HistoryDemandResponse) => {
    if (response.status === 'ready') {
      requested.delete(expected)
      return
    }
    requested.set(expected, { phase: pendingPhaseOf(response), at: Date.now() })
  }
  const rejectRequest = (expected: string, limited: boolean) => {
    requested.delete(expected)
    if (!isActiveTarget(expected)) return
    status.value = limited ? 'limit' : 'unavailable'
  }
  const request = async (force = false) => {
    const current = target.value
    if (!active.value || !current.onDemand || !current.typeId) return
    const expected = identityOf(current)
    const requestedPhase = currentRequest(expected)
    if (!force && requestedPhase) {
      await refreshCollection(expected, requestedPhase)
      return
    }
    if (pending.has(expected)) return
    pending.add(expected)
    try {
      const response = await postHistoryDemand(current)
      rememberResponse(expected, response)
      if (!isActiveTarget(expected)) return
      if (response.status === 'ready' && onReady) {
        onReady(response.history)
        stopPolling()
        status.value = 'idle'
        return
      }
      if (response.status === 'accepted') {
        await refreshCollection(expected, response.phase)
        return
      }
    } catch (error) {
      rejectRequest(expected, error instanceof ApiQueryError && error.code === demandLimitCode)
      return
    } finally {
      pending.delete(expected)
    }
    await refreshCollection(expected, currentRequest(expected))
  }
  const retry = () => {
    stopPolling()
    status.value = 'idle'
    void request(true)
  }

  let stopWatching: (() => void) | undefined
  onMounted(() => {
    mounted = true
    void request()
    stopWatching = watch([active, identity], () => {
      stopPolling()
      status.value = 'idle'
      void request()
    })
  })
  onUnmounted(() => {
    mounted = false
    stopWatching?.()
    stopPolling()
  })

  return { status, retry }
}
