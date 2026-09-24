import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import {
  definePlatformPersistenceOperation,
  platformPersistencePayloadMaximumBytes,
} from '../src/persistence.js'

describe('platform persistence operation definitions', () => {
  test('retains bounded schemas and stable operation metadata', () => {
    const inputSchema = z.object({ snapshotId: z.string().max(100) })
    const outputSchema = z.object({ value: z.string().max(1000).nullable() })

    expect(
      definePlatformPersistenceOperation({
        id: 'read-snapshot',
        inputSchema,
        maximumInputBytes: 1024,
        maximumOutputBytes: 4096,
        method: 'readSnapshot',
        mode: 'read',
        outputSchema,
        revision: 2,
      }),
    ).toStrictEqual({
      id: 'read-snapshot',
      inputSchema,
      maximumInputBytes: 1024,
      maximumOutputBytes: 4096,
      method: 'readSnapshot',
      mode: 'read',
      outputSchema,
      revision: 2,
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
        inputSchema: z.object({ snapshotId: z.string().max(100) }),
        maximumInputBytes: 1024,
        maximumOutputBytes: 4096,
        method: 'readSnapshot',
        mode: 'read',
        outputSchema: z.object({ value: z.string().max(1000).nullable() }),
        revision: 1,
        ...override,
      } as never),
    ).toThrow(expected)
  })
})
