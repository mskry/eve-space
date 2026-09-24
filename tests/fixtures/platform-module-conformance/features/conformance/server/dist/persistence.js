import { definePlatformPersistenceOperation } from '@eve-space/platform-module-server';
import { z } from 'zod';
const snapshotSchema = z.strictObject({
    characterId: z.number().int().positive(),
    pilotsOnline: z.number().int().nonnegative(),
    validatedAt: z.iso.datetime({ offset: true }),
});
export const readConformanceSnapshotOperation = definePlatformPersistenceOperation({
    id: 'read-conformance-snapshot',
    inputSchema: z.strictObject({ characterId: z.number().int().positive() }),
    maximumInputBytes: 64,
    maximumOutputBytes: 1024,
    method: 'readConformanceSnapshot',
    mode: 'read',
    outputSchema: z.union([snapshotSchema, z.null()]),
    revision: 1,
});
export const upsertConformanceSnapshotOperation = definePlatformPersistenceOperation({
    id: 'upsert-conformance-snapshot',
    inputSchema: snapshotSchema,
    maximumInputBytes: 1024,
    maximumOutputBytes: 64,
    method: 'upsertConformanceSnapshot',
    mode: 'write',
    outputSchema: z.strictObject({ applied: z.literal(true) }),
    revision: 1,
});
const conformancePersistenceOperations = {
    'read-conformance-snapshot': readConformanceSnapshotOperation,
    'upsert-conformance-snapshot': upsertConformanceSnapshotOperation,
};
