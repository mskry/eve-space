import { describe, expect, test } from 'vitest'
import {
  assertConnectedFixtureDatabase,
  parseLocalDatabaseGuard,
} from '../../src/commands/local-database-guard.js'

const databaseUrl = 'postgres://fixture:private@127.0.0.1:5432/eve_space_fixture'
const sessionHandoffPath = '/tmp/eve-space-fixture-session.html'
const sessionHandoffArgument = `--session-handoff=${sessionHandoffPath}`

describe('local organization fixture database guard', () => {
  test.each(['production', 'test', undefined])('refuses NODE_ENV=%s', (nodeEnvironment) => {
    expect(() =>
      parseLocalDatabaseGuard(['--confirm-database=eve_space_fixture', sessionHandoffArgument], {
        DATABASE_URL: databaseUrl,
        NODE_ENV: nodeEnvironment,
      }),
    ).toThrow('NODE_ENV=development')
  })

  test('requires a database URL', () => {
    expect(() =>
      parseLocalDatabaseGuard(['--confirm-database=eve_space_fixture', sessionHandoffArgument], {
        NODE_ENV: 'development',
      }),
    ).toThrow('require DATABASE_URL')
  })

  test.each([
    'postgres://fixture:private@database.internal:5432/eve_space_fixture',
    'postgres://fixture:private@localhost.example.com:5432/eve_space_fixture',
  ])('refuses non-loopback database URL %s', (url) => {
    expect(() =>
      parseLocalDatabaseGuard(['--confirm-database=eve_space_fixture', sessionHandoffArgument], {
        DATABASE_URL: url,
        NODE_ENV: 'development',
      }),
    ).toThrow('loopback database host')
  })

  test.each([
    ['not a URL', 'valid PostgreSQL URL'],
    ['redis://localhost/eve_space_fixture', 'PostgreSQL URL'],
    ['postgres://localhost/eve_space', 'eve_space_fixture database'],
    ['postgres://localhost/eve_space_fixture-unsafe', 'eve_space_fixture database'],
  ])('refuses unsafe database target', (url, message) => {
    expect(() =>
      parseLocalDatabaseGuard(['--confirm-database=eve_space_fixture', sessionHandoffArgument], {
        DATABASE_URL: url,
        NODE_ENV: 'development',
      }),
    ).toThrow(message)
  })

  test.each([
    [[]],
    [['--confirm-database=eve_space']],
    [['--confirm-database=eve_space_fixture']],
    [['--unexpected']],
  ] as const)('requires exact confirmation and handoff for arguments %j', (args) => {
    expect(() =>
      parseLocalDatabaseGuard(args, {
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'development',
      }),
    ).toThrow('exact database and session handoff arguments')
  })

  test('requires an absolute session handoff path', () => {
    expect(() =>
      parseLocalDatabaseGuard(
        ['--confirm-database=eve_space_fixture', '--session-handoff=fixture-session.html'],
        {
          DATABASE_URL: databaseUrl,
          NODE_ENV: 'development',
        },
      ),
    ).toThrow('must be absolute')
  })

  test.each([
    'postgres://fixture:private@localhost:5432/eve_space_fixture',
    'postgresql://fixture:private@127.0.0.1:5432/eve_space_fixture_test',
    'postgres://fixture:private@[::1]:5432/eve_space_fixture_ipv6',
  ])('accepts confirmed loopback fixture URL %s', (url) => {
    const databaseName = new URL(url).pathname.slice(1)
    expect(
      parseLocalDatabaseGuard([`--confirm-database=${databaseName}`, sessionHandoffArgument], {
        DATABASE_URL: url,
        NODE_ENV: 'development',
      }),
    ).toStrictEqual({ databaseName, databaseUrl: url, sessionHandoffPath })
  })

  test('does not include credentials or URLs in failures', () => {
    let message = ''
    try {
      parseLocalDatabaseGuard(['--confirm-database=wrong', sessionHandoffArgument], {
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'development',
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).not.toMatch(/fixture:private|postgres:/)
  })

  test('requires the connected database to match the confirmation', () => {
    expect(() => assertConnectedFixtureDatabase('eve_space_fixture', 'eve_space')).toThrow(
      'does not match',
    )
    expect(() =>
      assertConnectedFixtureDatabase('eve_space_fixture', 'eve_space_fixture'),
    ).not.toThrow()
  })
})
