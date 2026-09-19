import type { PlatformModuleRouteCapabilities, PlatformOwnedCharacterRouteEnv } from '@eve-space/platform-module-contract/server';
type ConformanceRouteCapabilities = PlatformModuleRouteCapabilities;
export declare function conformanceRoutes(capabilities: ConformanceRouteCapabilities): import("hono/hono-base").HonoBase<PlatformOwnedCharacterRouteEnv, {
    "/": {
        $get: {
            output: {
                characterId: number;
                corporationId: number | null;
                organizationVersion: number;
                resource: {
                    readonly subjectLifecycleId?: string;
                    readonly authorizationGeneration: number | null;
                    readonly lastFailureClass: import("@eve-space/platform-module-contract/server").PlatformCollectionFailureClass | null;
                    readonly validatedAt: string | null;
                    readonly status: 'current' | 'stale';
                } | {
                    readonly subjectLifecycleId?: string;
                    readonly authorizationGeneration: number | null;
                    readonly lastFailureClass: import("@eve-space/platform-module-contract/server").PlatformCollectionFailureClass | null;
                    readonly validatedAt: string | null;
                    readonly status: 'never-collected' | 'never-configured' | 'unavailable';
                } | {
                    readonly subjectLifecycleId?: string;
                    readonly authorizationGeneration: number | null;
                    readonly lastFailureClass: "authorization-required";
                    readonly validatedAt: string | null;
                    readonly status: 'authorization-required';
                    readonly requiredScope: string;
                    readonly reauthorizationPath: string;
                };
                view: "summary";
            };
            outputFormat: "json";
            status: 200;
            input: {
                query: {
                    view: "conflict" | "summary";
                };
            };
        };
    };
}, "/", "/">;
export {};
