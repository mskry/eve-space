import type { PlatformPersistenceMethodsFor } from '@eve-space/platform-module-contract'
import { definePlatformPersistenceOperation } from '@eve-space/platform-module-server'
import { z } from 'zod'

const snapshotSchema = z.strictObject({
  characterId: z.number().int().positive(),
  pilotsOnline: z.number().int().nonnegative(),
  validatedAt: z.iso.datetime({ offset: true }),
})

export const readConformanceSnapshotOperation = definePlatformPersistenceOperation({
  id: 'read-conformance-snapshot',
  method: 'readConformanceSnapshot',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({ characterId: z.number().int().positive() }),
  outputSchema: z.union([snapshotSchema, z.null()]),
  maximumInputBytes: 64,
  maximumOutputBytes: 1_024,
})

export const upsertConformanceSnapshotOperation = definePlatformPersistenceOperation({
  id: 'upsert-conformance-snapshot',
  method: 'upsertConformanceSnapshot',
  revision: 1,
  mode: 'write',
  inputSchema: snapshotSchema,
  outputSchema: z.strictObject({ applied: z.literal(true) }),
  maximumInputBytes: 1_024,
  maximumOutputBytes: 64,
})

const conformancePersistenceOperations = {
  'read-conformance-snapshot': readConformanceSnapshotOperation,
  'upsert-conformance-snapshot': upsertConformanceSnapshotOperation,
} as const

export type ConformanceSnapshotReadPersistence = PlatformPersistenceMethodsFor<
  typeof conformancePersistenceOperations,
  readonly ['read-conformance-snapshot']
>

export type ConformanceSnapshotWritePersistence = PlatformPersistenceMethodsFor<
  typeof conformancePersistenceOperations,
  readonly ['upsert-conformance-snapshot']
>
