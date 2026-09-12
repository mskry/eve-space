import { describe, expect, it } from 'vitest'
import { assertCacheValueSafe } from '../../src/esi-gateway/internal/cache-redaction.js'

describe('ESI cache redaction', () => {
  it('accepts nested values without sensitive field names', () => {
    expect(() =>
      assertCacheValueSafe({ character: { id: 1, corporation: { name: 'Safe' } } }),
    ).not.toThrow()
  })

  it.each(['accessToken', 'bearer', 'credential', 'clientSecret', 'sessionId'])(
    'rejects the sensitive field %s',
    (key) => {
      expect(() => assertCacheValueSafe({ nested: { [key]: 'unsafe' } })).toThrow(
        'Unsafe cache value',
      )
    },
  )
})
