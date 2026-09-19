import { type PlatformCharacterResourceSubject } from '@eve-space/platform-module-contract/resources';
import type { ConformanceSnapshotWritePersistence } from './persistence.js';
interface ConformanceStatusData {
    readonly players: number;
}
interface ConformanceStatusProjection extends ConformanceStatusData {
    readonly publishedTypeCount?: number;
    readonly sdeBuildNumber?: number;
}
export declare const conformanceStatusResource: import("@eve-space/platform-module-contract/resources").PlatformResourceOperationImplementation<"conformance-status-operation", ConformanceStatusData, ConformanceStatusProjection, string, unknown, PlatformCharacterResourceSubject, readonly ["published-type-groups"], object, ConformanceSnapshotWritePersistence, object>;
export {};
