import { describe, expect, it } from 'vitest'
import { isOwnerEmail } from '../../app/utils/admin-credentials'

describe('administrator credentials', () => {
  it.each([
    ['owner@corp.eve', true],
    ['owner@mail.corp.eve', true],
    ['  owner@corp.eve  ', true],
    ['owner@corp', false],
    ['owner@@corp.eve', false],
    ['owner@.eve', false],
    ['owner@corp.', false],
    ['owner name@corp.eve', false],
  ])('validates owner email %j', (email, expected) => {
    expect(isOwnerEmail(email)).toBe(expected)
  })

  it('rejects a long near-match with repeated domain separators', () => {
    expect(isOwnerEmail(`owner@${'segment.'.repeat(5_000)}@`)).toBe(false)
  })
})
