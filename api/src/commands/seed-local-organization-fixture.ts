import { open, rm, type FileHandle } from 'node:fs/promises'
import postgres from 'postgres'
import { assertConnectedFixtureDatabase, parseLocalDatabaseGuard } from './local-database-guard.js'
import { env } from '../env.js'
import { recordDiagnostic } from '../logging.js'

const guard = parseLocalDatabaseGuard(process.argv.slice(2), process.env)
const migrationConnection = postgres(guard.databaseUrl, { max: 1, onnotice: () => {} })
let sessionHandoffFile: FileHandle | undefined
let retainSessionHandoff = false

try {
  sessionHandoffFile = await open(guard.sessionHandoffPath, 'wx', 0o600)
  const [identity] = await migrationConnection<{ databaseName: string }[]>`
    select current_database() as "databaseName"
  `
  assertConnectedFixtureDatabase(guard.databaseName, identity?.databaseName)
  const { runStartupMigrations } = await import('../db/startup-migrations.js')
  await runStartupMigrations(migrationConnection)
  const { seedLocalOrganizationFixture } = await import('./local-organization-fixture.js')
  const result = await seedLocalOrganizationFixture({
    deliverSession: async (sessionToken) => {
      await sessionHandoffFile!.writeFile(createSessionHandoffDocument(sessionToken), 'utf8')
    },
  })
  retainSessionHandoff = true
  console.log(JSON.stringify({ ...result, sessionHandoffPath: guard.sessionHandoffPath }))
} catch (error) {
  recordDiagnostic('command.organization-fixture.failed', { error })
  process.exitCode = 1
} finally {
  await cleanUp(() => sessionHandoffFile?.close())
  await cleanUp(() =>
    sessionHandoffFile && !retainSessionHandoff
      ? rm(guard.sessionHandoffPath, { force: true })
      : undefined,
  )
  await cleanUp(() => migrationConnection.end())
  await cleanUp(async () => {
    const { sql } = await import('../db/client.js')
    await sql.end()
  })
}

async function cleanUp(operation: () => Promise<unknown> | undefined) {
  try {
    await operation()
  } catch (error) {
    recordDiagnostic('command.organization-fixture.failed', { error })
    process.exitCode = 1
  }
}

function createSessionHandoffDocument(sessionToken: string) {
  const action = new URL('/auth/local-fixture-session', env.EVE_CALLBACK_URL).toString()
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="referrer" content="no-referrer">
  <title>EVE Space local fixture sign-in</title>
</head>
<body>
  <form method="post" action="${escapeHtmlAttribute(action)}" autocomplete="off">
    <input type="hidden" name="sessionToken" value="${escapeHtmlAttribute(sessionToken)}">
    <button type="submit">Sign in as Fixture Director</button>
  </form>
</body>
</html>
`
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
