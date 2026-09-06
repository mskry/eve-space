import { definePlatformExecutableEsiOperation } from '@eve-space/platform-module-server'

export const conformanceStatusOperation = definePlatformExecutableEsiOperation({
  sdkOperationId: 'GetStatus',
  policy: {
    audit: { reviewedDate: '2026-09-06' },
    representationVersion: 'v1',
    authorization: { kind: 'public' },
    identity: { kind: 'ordered', fields: [] },
    freshness: { kind: 'relative', seconds: 60 },
    cache: {
      kind: 'shared',
      collapse: true,
      revalidate: true,
      stale: { kind: 'none' },
      retentionMilliseconds: 300_000,
    },
    rateGroup: { kind: 'legacy-only' },
    retry: { kind: 'none' },
    compatibility: { minimumDate: '2026-09-01' },
    responseValidation: { kind: 'enabled' },
  },
})
