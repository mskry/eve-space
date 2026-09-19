import type { PlatformPersistenceMethodsFor } from '@eve-space/platform-module-contract/persistence';
import { z } from 'zod';
export declare const readConformanceSnapshotOperation: import("@eve-space/platform-module-server").PlatformPersistenceOperationDefinition<"read-conformance-snapshot", "readConformanceSnapshot", 1, "read", z.ZodObject<{
    characterId: z.ZodNumber;
}, z.core.$strict>, z.ZodUnion<readonly [z.ZodObject<{
    characterId: z.ZodNumber;
    pilotsOnline: z.ZodNumber;
    validatedAt: z.ZodISODateTime;
}, z.core.$strict>, z.ZodNull]>>;
export declare const upsertConformanceSnapshotOperation: import("@eve-space/platform-module-server").PlatformPersistenceOperationDefinition<"upsert-conformance-snapshot", "upsertConformanceSnapshot", 1, "write", z.ZodObject<{
    characterId: z.ZodNumber;
    pilotsOnline: z.ZodNumber;
    validatedAt: z.ZodISODateTime;
}, z.core.$strict>, z.ZodObject<{
    applied: z.ZodLiteral<true>;
}, z.core.$strict>>;
declare const conformancePersistenceOperations: {
    readonly 'read-conformance-snapshot': import("@eve-space/platform-module-server").PlatformPersistenceOperationDefinition<"read-conformance-snapshot", "readConformanceSnapshot", 1, "read", z.ZodObject<{
        characterId: z.ZodNumber;
    }, z.core.$strict>, z.ZodUnion<readonly [z.ZodObject<{
        characterId: z.ZodNumber;
        pilotsOnline: z.ZodNumber;
        validatedAt: z.ZodISODateTime;
    }, z.core.$strict>, z.ZodNull]>>;
    readonly 'upsert-conformance-snapshot': import("@eve-space/platform-module-server").PlatformPersistenceOperationDefinition<"upsert-conformance-snapshot", "upsertConformanceSnapshot", 1, "write", z.ZodObject<{
        characterId: z.ZodNumber;
        pilotsOnline: z.ZodNumber;
        validatedAt: z.ZodISODateTime;
    }, z.core.$strict>, z.ZodObject<{
        applied: z.ZodLiteral<true>;
    }, z.core.$strict>>;
};
export type ConformanceSnapshotReadPersistence = PlatformPersistenceMethodsFor<typeof conformancePersistenceOperations, readonly ['read-conformance-snapshot']>;
export type ConformanceSnapshotWritePersistence = PlatformPersistenceMethodsFor<typeof conformancePersistenceOperations, readonly ['upsert-conformance-snapshot']>;
export {};
