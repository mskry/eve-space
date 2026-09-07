import { describe, expect, test } from 'vitest'
import { maskSqlLiteralsAndComments } from '../../src/db/sql-validation.js'

describe('SQL literal and comment masking', () => {
  test.each(['a--b', 'a/*b', "a'b", 'a$$b', 'a""b;𐐷'])(
    'consumes preserved identifiers atomically: %s',
    (identifier) => {
      const sql = `select "${identifier}"; select * from public.users; -- hidden`
      const masked = maskSqlLiteralsAndComments(sql, {
        preserveQuotedIdentifiers: true,
        rejectUnterminated: true,
      })
      expect(masked).toBe(`select "${identifier}"; select * from public.users; ${' '.repeat(9)}`)
      expect(masked).toHaveLength(sql.length)
      expect(maskSqlLiteralsAndComments(sql)).toHaveLength(sql.length)
      expect(masked.indexOf('public.users')).toBe(sql.indexOf('public.users'))
    },
  )

  test('still rejects unterminated preserved identifiers', () => {
    expect(() =>
      maskSqlLiteralsAndComments('select "a--b', {
        preserveQuotedIdentifiers: true,
        rejectUnterminated: true,
      }),
    ).toThrow('Unterminated SQL quoted identifier')
  })
})
