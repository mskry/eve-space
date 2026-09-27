const metadata = {
  authorization_endpoint: 'https://login.eveonline.com/v2/oauth/authorize',
  issuer: 'https://login.eveonline.com',
  jwks_uri: 'https://login.eveonline.com/oauth/jwks',
  token_endpoint: 'https://login.eveonline.com/v2/oauth/token',
}

const upstreamFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = String(input)
  if (url === 'https://login.eveonline.com/.well-known/oauth-authorization-server') {
    return new Response(JSON.stringify(metadata))
  }
  if (url === metadata.jwks_uri) {
    return new Response(process.env.TEST_JWKS)
  }
  throw new Error(`Unexpected SSO request to ${url} (${init?.method ?? 'GET'})`)
}

try {
  if (process.env.TEST_RUNTIME_ROLE === 'worker') {
    const { expectedWorkerMigration } = await import('../../src/worker/readiness.js')
    const { sql } = await import('../../src/db/client.js')
    const [migration] = await sql<{ name: string }[]>`
      select name from schema_migrations
      where module = 'core' and name = ${expectedWorkerMigration}
    `
    if (!migration) {
      throw new Error('Worker-required migration is missing')
    }
  }
  const { getCharacterAuthorizationForLifecycle } = await import('../../src/auth/tokens.js')
  const result = await getCharacterAuthorizationForLifecycle(
    Number(process.env.TEST_CHARACTER_ID),
    process.env.TEST_LIFECYCLE_ID!,
    'scope.one',
  )
  if (result.accessToken !== process.env.TEST_ACCESS_TOKEN) {
    throw new Error('Recovered the wrong access token')
  }
  console.log(JSON.stringify({ tokenVersion: result.tokenVersion }))
} finally {
  globalThis.fetch = upstreamFetch
  const { sql } = await import('../../src/db/client.js')
  await sql.end()
}
