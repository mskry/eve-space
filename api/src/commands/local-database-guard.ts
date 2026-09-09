import { isAbsolute } from 'node:path'

const fixtureDatabasePattern = /^eve_space_fixture(?:_[a-z0-9_]+)?$/
const localDatabaseHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export interface LocalDatabaseGuardResult {
  readonly databaseName: string
  readonly databaseUrl: string
  readonly sessionHandoffPath: string
}

export function parseLocalDatabaseGuard(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): LocalDatabaseGuardResult {
  if (environment.NODE_ENV !== 'development')
    throw new Error('Local organization fixtures require NODE_ENV=development')

  const databaseUrl = environment.DATABASE_URL
  if (!databaseUrl) throw new Error('Local organization fixtures require DATABASE_URL')

  let parsed: URL
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new Error('Local organization fixtures require a valid PostgreSQL URL')
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol))
    throw new Error('Local organization fixtures require a PostgreSQL URL')
  if (!localDatabaseHosts.has(parsed.hostname))
    throw new Error('Local organization fixtures require a loopback database host')

  const databaseName = decodeURIComponent(parsed.pathname.slice(1))
  if (!fixtureDatabasePattern.test(databaseName))
    throw new Error('Local organization fixtures require an eve_space_fixture database')

  const argumentsWithoutSeparator = args.filter((argument) => argument !== '--')
  const confirmationArguments = argumentsWithoutSeparator.filter((argument) =>
    argument.startsWith('--confirm-database='),
  )
  const sessionHandoffArguments = argumentsWithoutSeparator.filter((argument) =>
    argument.startsWith('--session-handoff='),
  )
  if (
    confirmationArguments.length !== 1 ||
    sessionHandoffArguments.length !== 1 ||
    argumentsWithoutSeparator.length !== 2 ||
    confirmationArguments[0] !== `--confirm-database=${databaseName}`
  )
    throw new Error(
      'Local organization fixtures require exact database and session handoff arguments',
    )

  const sessionHandoffPath = sessionHandoffArguments[0]!.slice('--session-handoff='.length)
  if (!isAbsolute(sessionHandoffPath))
    throw new Error('Local organization fixture session handoff path must be absolute')

  return { databaseName, databaseUrl, sessionHandoffPath }
}

export function assertConnectedFixtureDatabase(
  expectedDatabaseName: string,
  actualDatabaseName: string | undefined,
) {
  if (actualDatabaseName !== expectedDatabaseName)
    throw new Error('Connected database does not match the confirmed fixture database')
}
