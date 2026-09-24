export declare const conformanceStatusOperation: import("@eve-space/platform-module-server").PlatformExecutableEsiOperationDefinition<"GetStatus", {
    readonly audit: {
        readonly reviewedDate: "2026-09-06";
    };
    readonly authorization: {
        readonly kind: "public";
    };
    readonly cache: {
        readonly collapse: true;
        readonly kind: "shared";
        readonly retentionMilliseconds: 300000;
        readonly revalidate: true;
        readonly stale: {
            readonly kind: "none";
        };
    };
    readonly compatibility: {
        readonly minimumDate: "2026-09-01";
    };
    readonly freshness: {
        readonly kind: "relative";
        readonly seconds: 60;
    };
    readonly identity: {
        readonly fields: readonly [];
        readonly kind: "ordered";
    };
    readonly rateGroup: {
        readonly kind: "legacy-only";
    };
    readonly representationVersion: "v1";
    readonly responseValidation: {
        readonly kind: "enabled";
    };
    readonly retry: {
        readonly kind: "none";
    };
} & {
    readonly audit: {
        readonly reviewedDate: "2026-09-06";
    } & {
        readonly esiOperationId: "GetStatus";
    };
}>;
