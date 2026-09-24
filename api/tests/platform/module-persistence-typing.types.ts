import type {
  PlatformPersistenceMethodsFor,
  PlatformPersistenceMethodsForReferences,
  PlatformPersistenceOperationContract,
  PlatformPersistenceOperationIdentity,
  PlatformPersistenceOperationInput,
  PlatformPersistenceOperationOutput,
} from '@eve-space/platform-module-contract/persistence'
import { definePlatformPersistenceOperation } from '@eve-space/platform-module-server'
import { z } from 'zod'

interface ReadSnapshotInput {
  readonly snapshotId: string
}

interface ReadSnapshotOutput {
  readonly value: string | null
}

interface SaveSnapshotInput {
  readonly snapshotId: string
  readonly value: string
}

interface SaveSnapshotOutput {
  readonly saved: true
}

type Operations = {
  readonly 'read-snapshot': PlatformPersistenceOperationContract<
    'read-snapshot',
    'readSnapshot',
    1,
    'read',
    ReadSnapshotInput,
    ReadSnapshotOutput
  >
  readonly 'save-snapshot': PlatformPersistenceOperationContract<
    'save-snapshot',
    'saveSnapshot',
    2,
    'write',
    SaveSnapshotInput,
    SaveSnapshotOutput
  >
}

declare const identity: PlatformPersistenceOperationIdentity<'module-a', 'read-snapshot', 1>
declare const readPersistence: PlatformPersistenceMethodsFor<Operations, readonly ['read-snapshot']>
declare const allPersistence: PlatformPersistenceMethodsFor<
  Operations,
  readonly ['read-snapshot', 'save-snapshot']
>
declare const referencedPersistence: PlatformPersistenceMethodsForReferences<
  Operations,
  readonly [{ readonly operationId: 'read-snapshot' }]
>

void (identity.moduleId satisfies 'module-a')
void (identity.operationId satisfies 'read-snapshot')
void (identity.revision satisfies 1)

const readResult: Promise<ReadSnapshotOutput> = readPersistence.readSnapshot({
  snapshotId: 'snapshot-1',
})
const saveResult: Promise<SaveSnapshotOutput> = allPersistence.saveSnapshot({
  snapshotId: 'snapshot-1',
  value: 'saved',
})
const referencedResult: Promise<ReadSnapshotOutput> = referencedPersistence.readSnapshot({
  snapshotId: 'snapshot-1',
})
void readResult
void saveResult
void referencedResult

type InferredInput = PlatformPersistenceOperationInput<Operations['save-snapshot']>
type InferredOutput = PlatformPersistenceOperationOutput<Operations['save-snapshot']>
void ({ snapshotId: 'snapshot-1', value: 'saved' } satisfies InferredInput)
void ({ saved: true } satisfies InferredOutput)

// @ts-expect-error contribution receives only its declared operation methods
void readPersistence.saveSnapshot({ snapshotId: 'snapshot-1', value: 'forbidden' })
// @ts-expect-error referenced contribution receives no unlisted operation method
void referencedPersistence.saveSnapshot({ snapshotId: 'snapshot-1', value: 'forbidden' })
// @ts-expect-error operation input is inferred from the declared contract
void readPersistence.readSnapshot({ snapshotId: 1 })
// @ts-expect-error operation result is inferred from the declared contract
const invalidResult: Promise<SaveSnapshotInput> = allPersistence.saveSnapshot({
  snapshotId: 'snapshot-1',
  value: 'saved',
})
void invalidResult

const definedReadSnapshot = definePlatformPersistenceOperation({
  id: 'read-snapshot',
  inputSchema: z.object({ snapshotId: z.string().max(100) }),
  maximumInputBytes: 1024,
  maximumOutputBytes: 4096,
  method: 'readSnapshot',
  mode: 'read',
  outputSchema: z.object({ value: z.string().max(1000).nullable() }),
  revision: 1,
})

type DefinedOperations = { readonly 'read-snapshot': typeof definedReadSnapshot }
declare const definedPersistence: PlatformPersistenceMethodsFor<
  DefinedOperations,
  readonly ['read-snapshot']
>

const definedResult: Promise<{ value: string | null }> = definedPersistence.readSnapshot({
  snapshotId: 'snapshot-1',
})
void definedResult
// @ts-expect-error helper preserves the Zod input schema in the generated method argument
void definedPersistence.readSnapshot({ snapshotId: 1 })
// @ts-expect-error helper preserves the Zod output schema in the generated method result
const invalidDefinedResult: Promise<{ value: number }> = definedPersistence.readSnapshot({
  snapshotId: 'snapshot-1',
})
void invalidDefinedResult
