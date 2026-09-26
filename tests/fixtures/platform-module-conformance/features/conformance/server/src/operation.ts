import { definePlatformExecutableEsiOperation } from '@eve-space/platform-module-server'

export const conformanceStatusOperation = definePlatformExecutableEsiOperation({
  policy: {
    audit: { reviewedDate: '2026-09-06' },
    cache: {
      collapse: true,
      kind: 'shared',
      retentionMilliseconds: 300_000,
      stale: { kind: 'none' },
    },
    identity: { fields: [], kind: 'ordered' },
    representationVersion: 'v1',
    retry: { kind: 'none' },
  },
  sdkOperationId: 'GetStatus',
})
