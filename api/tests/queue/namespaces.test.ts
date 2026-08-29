import { describe, expect, test } from 'vitest'
import { assertSafeJobPayload } from '../../src/queue/job-registry.js'
import { queueNamespaces, queuePrefix } from '../../src/queue/namespaces.js'

describe('queue namespaces', () => {
  test('keeps every key under the versioned prefix', () => {
    // Redis is configured `noeviction` for this prefix, so a key declared outside it would be
    // durable queue state living in an unprotected keyspace.
    expect(queueNamespaces.length).toBeGreaterThan(0)
    for (const namespace of queueNamespaces)
      expect(namespace.startsWith(`${queuePrefix}:`)).toBe(true)
  })

  test('cannot carry a token, credential, or session bearer in a key', () => {
    expect(() => assertSafeJobPayload(queueNamespaces)).not.toThrow()
  })
})
