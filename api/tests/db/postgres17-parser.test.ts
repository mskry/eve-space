import { describe, expect, test, vi } from 'vitest'
import {
  parsePostgres17Migration,
  PostgresMigrationParseError,
} from '../../src/db/postgres17-parser.js'
import { assertModuleMigrationAstPolicy } from '../../src/db/module-migration-ast-policy.js'

describe('PostgreSQL 17 parser adapter', () => {
  test('loads the versioned WASM parser and reports its grammar identity', async () => {
    await expect(parsePostgres17Migration('select 17')).resolves.toMatchObject({
      grammarMajorVersion: 17,
      parserVersion: 170004,
      statements: [{ kind: 'SelectStmt' }],
    })
  })

  test('passes exact migration text to the parser', async () => {
    const sql = 'select 1;\r\n-- exact bytes\r\nselect 2;'
    const parse = vi.fn(async () => ({
      version: 170004,
      stmts: [{ stmt: { SelectStmt: {} } }],
    }))

    await parsePostgres17Migration(sql, () => ({ parse }))

    expect(parse).toHaveBeenCalledOnce()
    expect(parse).toHaveBeenCalledWith(sql)
  })

  test.each([
    [
      'load',
      () =>
        parsePostgres17Migration('select 1', () => {
          throw new Error('secret')
        }),
    ],
    [
      'syntax',
      () =>
        parsePostgres17Migration("select 'secret", () => ({
          parse: async () => {
            throw new Error("syntax error near 'secret")
          },
        })),
    ],
    [
      'version',
      () =>
        parsePostgres17Migration('select 1', () => ({
          parse: async () => ({ version: 160006, stmts: [] }),
        })),
    ],
    [
      'result',
      () =>
        parsePostgres17Migration('select 1', () => ({
          parse: async () => ({ version: 170004, stmts: [{ stmt: {} }] }),
        })),
    ],
  ])('maps a %s failure without exposing parser diagnostics', async (failure, parse) => {
    const error = await parse().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(PostgresMigrationParseError)
    expect(error).toMatchObject({ failure })
    expect(String(error)).not.toContain('secret')
  })

  test('rejects an unreviewed nested AST node', () => {
    expect(() =>
      assertModuleMigrationAstPolicy('eve_module_alpha', {
        grammarMajorVersion: 17,
        parserVersion: 170004,
        statements: [
          {
            kind: 'SelectStmt',
            node: { futureReference: { FutureReference: { schemaname: 'public' } } },
          },
        ],
      }),
    ).toThrow('unsupported-statement')
  })

  test('rejects a malformed known reference node', () => {
    expect(() =>
      assertModuleMigrationAstPolicy('eve_module_alpha', {
        grammarMajorVersion: 17,
        parserVersion: 170004,
        statements: [
          {
            kind: 'SelectStmt',
            node: {
              fromClause: [
                {
                  RangeVar: {
                    relname: 'records',
                    relpersistence: 'p',
                    schemaname: 17,
                  },
                },
              ],
            },
          },
        ],
      }),
    ).toThrow('unsupported-statement')
  })
})
