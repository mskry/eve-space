import { QUERY_GC_TIME } from '../utils/colada-options'

export const QUERY_POLICY = {
  authConfig: { staleTime: 5 * 60_000, gcTime: QUERY_GC_TIME },
  authSession: { staleTime: 30_000, gcTime: QUERY_GC_TIME },
  systemStatus: { staleTime: 15_000, gcTime: QUERY_GC_TIME },
  characterRoster: { staleTime: 30_000, gcTime: QUERY_GC_TIME },
  characterOverview: { staleTime: 30_000, gcTime: QUERY_GC_TIME },
  characterSkills: { staleTime: 5 * 60_000, gcTime: QUERY_GC_TIME },
  characterHistory: { staleTime: 5 * 60_000, gcTime: QUERY_GC_TIME },
  wallet: { staleTime: 30_000, gcTime: QUERY_GC_TIME },
  walletTransactions: { staleTime: 5 * 60_000, gcTime: QUERY_GC_TIME },
  corporation: { staleTime: 5 * 60_000, gcTime: QUERY_GC_TIME },
  corporationAllianceHistory: { staleTime: 5 * 60_000, gcTime: QUERY_GC_TIME },
} as const
