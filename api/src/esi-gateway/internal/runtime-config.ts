export interface EsiExecutionRuntimeConfig {
  readonly cacheL1Capacity: number
  readonly cacheMaximumRetentionMs: number
  readonly compatibilityDate: string
  readonly operationConcurrency: number
  readonly operationQueueTimeoutMs: number
  readonly privateRetentionMs: number
  readonly requestTimeoutMs: number
}
