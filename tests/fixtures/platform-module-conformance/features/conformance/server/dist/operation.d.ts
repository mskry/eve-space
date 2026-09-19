export declare const conformanceStatusOperation: import("@eve-space/platform-module-server").PlatformExecutableEsiOperationDefinition<"GetStatus", {
    readonly audit: {
        readonly reviewedDate: "2026-09-06";
    };
    readonly representationVersion: "v1";
    readonly authorization: {
        readonly kind: "public";
    };
    readonly identity: {
        readonly kind: "ordered";
        readonly fields: readonly [];
    };
    readonly freshness: {
        readonly kind: "relative";
        readonly seconds: 60;
    };
    readonly cache: {
        readonly kind: "shared";
        readonly collapse: true;
        readonly revalidate: true;
        readonly stale: {
            readonly kind: "none";
        };
        readonly retentionMilliseconds: 300000;
    };
    readonly rateGroup: {
        readonly kind: "legacy-only";
    };
    readonly retry: {
        readonly kind: "none";
    };
    readonly compatibility: {
        readonly minimumDate: "2026-09-01";
    };
    readonly responseValidation: {
        readonly kind: "enabled";
    };
} & {
    readonly audit: {
        readonly reviewedDate: "2026-09-06";
    } & {
        readonly esiOperationId: "GetStatus";
    };
}>;
