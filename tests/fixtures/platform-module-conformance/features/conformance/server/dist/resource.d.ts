import { type PlatformCharacterResourceSubject } from '@eve-space/platform-module-contract/resources';
import type { PlatformCoreEsiOperationProtocol, PlatformExecutableEsiOperationProtocol } from '@eve-space/platform-module-server';
import type { conformanceStatusOperation } from './operation.js';
import type { ConformanceSnapshotReadPersistence, ConformanceSnapshotWritePersistence } from './persistence.js';
interface ConformanceStatusProjection {
    readonly players: number;
    readonly publishedTypeCount?: number;
    readonly sdeBuildNumber?: number;
    readonly characterName?: string | null;
    readonly previousPlayers?: number | null;
}
type ConformanceStatusProtocol = PlatformExecutableEsiOperationProtocol<{
    readonly 'conformance-status-operation': typeof conformanceStatusOperation;
}, 'conformance-status-operation'>;
type ConformanceCollectionProtocol = ConformanceStatusProtocol & PlatformCoreEsiOperationProtocol<'universe-resolve-names'>;
export declare const conformanceStatusResource: import("@eve-space/platform-module-contract/resources").PlatformSingleRequestResourceImplementation<"conformance-status-operation", ConformanceStatusProtocol, ConformanceStatusProjection, string, unknown, PlatformCharacterResourceSubject, readonly ["published-type-groups"], ConformanceSnapshotWritePersistence, object>;
export declare const conformanceCollectionResource: import("@eve-space/platform-module-contract/resources").PlatformBoundedCollectionResourceImplementation<"conformance-status-operation", ConformanceCollectionProtocol, ConformanceStatusProjection, string, unknown, PlatformCharacterResourceSubject, readonly [], ConformanceSnapshotReadPersistence, ConformanceSnapshotWritePersistence, object>;
export {};
