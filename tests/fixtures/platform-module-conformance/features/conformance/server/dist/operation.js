import { definePlatformExecutableEsiOperation } from '@eve-space/platform-module-server';
export const conformanceStatusOperation = definePlatformExecutableEsiOperation({
    policy: {
        audit: { reviewedDate: '2026-09-06' },
        authorization: { kind: 'public' },
        cache: {
            collapse: true,
            kind: 'shared',
            retentionMilliseconds: 300_000,
            revalidate: true,
            stale: { kind: 'none' },
        },
        compatibility: { minimumDate: '2026-09-01' },
        freshness: { kind: 'relative', seconds: 60 },
        identity: { fields: [], kind: 'ordered' },
        rateGroup: { kind: 'legacy-only' },
        representationVersion: 'v1',
        responseValidation: { kind: 'enabled' },
        retry: { kind: 'none' },
    },
    sdkOperationId: 'GetStatus',
});
