import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import {
  definePlatformPersistenceOperation,
  platformPersistencePayloadMaximumBytes,
} from '../src/persistence.js'

describe('platform persistence operation definitions', () => {
  test('retains bounded schemas and stable operation metadata', () => {
    const inputSchema = z.object({ snapshotId: z.string().max(100) })
    const outputSchema = z.object({ value: z.string().max(1_000).nullable() })

    expect(
      definePlatformPersistenceOperation({
        id: 'read-snapshot',
        method: 'readSnapshot',
        revision: 2,
        mode: 'read',
        inputSchema,
        outputSchema,
        maximumInputBytes: 1_024,
        maximumOutputBytes: 4_096,
      }),
    ).toEqual({
      id: 'read-snapshot',
      method: 'readSnapshot',
      revision: 2,
      mode: 'read',
      inputSchema,
      outputSchema,
      maximumInputBytes: 1_024,
      maximumOutputBytes: 4_096,
    })
  })

  test.each([
    [{ id: 'ReadSnapshot' }, 'Invalid persistence operation identity'],
    [{ method: 'read-snapshot' }, 'Invalid persistence operation method'],
    [{ revision: 0 }, 'Invalid persistence operation revision'],
    [{ mode: 'execute' }, 'Invalid persistence operation mode'],
    [{ maximumInputBytes: 0 }, 'Invalid persistence operation input bound'],
    [
      { maximumOutputBytes: platformPersistencePayloadMaximumBytes + 1 },
      'Invalid persistence operation output bound',
    ],
  ])('rejects invalid operation metadata: %o', (override, expected) => {
    expect(() =>
      definePlatformPersistenceOperation({
        id: 'read-snapshot',
        method: 'readSnapshot',
        revision: 1,
        mode: 'read',
        inputSchema: z.object({ snapshotId: z.string().max(100) }),
        outputSchema: z.object({ value: z.string().max(1_000).nullable() }),
        maximumInputBytes: 1_024,
        maximumOutputBytes: 4_096,
        ...override,
      } as never),
    ).toThrow(expected)
  })
})
