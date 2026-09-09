import { describe, expect, test } from 'vitest'
import { containsSensitiveText } from '../src/sensitive-data.js'

describe('containsSensitiveText', () => {
  test.each([
    'access_token=private-value',
    'refresh token: private-value',
    'session-bearer=private-value',
    'session token=private-value',
    'Authorization=private-value',
    'credential=private-value',
    'password=private-value',
    'secret=private-value',
    'token encryption key=private-value',
    'encryption_key=private-value',
    'private-key=private-value',
    '{"access_token":"private-value"}',
    '{"password":"private-value"}',
    'Bearer abcdefgh',
  ])('detects %s', (value) => {
    expect(containsSensitiveText(value)).toBe(true)
  })

  test('does not treat an unrelated assignment as sensitive', () => {
    expect(containsSensitiveText('resource=corporation-projects')).toBe(false)
  })
})
