import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import type { Server } from 'node:http'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import postgres from 'postgres'
import { GenericContainer, Wait } from 'testcontainers'

export interface FakeEveCharacter {
  characterId: number
  characterName: string
  corporationId: number
  allianceId: number | null
  scopes: string[]
}

const startingApiHandler = () => new Response('API is starting.', { status: 503 })

export async function startAuthE2eInfrastructure() {
  const databasePassword = randomUUID()
  const container = await new GenericContainer('postgres:17-alpine')
    .withEnvironment({
      POSTGRES_DB: 'eve_space',
      POSTGRES_PASSWORD: databasePassword,
      POSTGRES_USER: 'eve_space',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/))
    .start()
  const databaseUrl = `postgres://eve_space:${databasePassword}@${container.getHost()}:${container.getMappedPort(5432)}/eve_space`
  const connection = postgres(databaseUrl, { onnotice: () => {} })
  await waitForDatabase(connection)
  const api = await startMutableApiServer()
  const sso = await startFakeEveSso(api.origin)

  return {
    api,
    connection,
    container,
    databaseUrl,
    sso,
    async close() {
      await api.close()
      await sso.close()
      await connection.end()
      await container.stop()
    },
  }
}

async function startMutableApiServer() {
  let handler = startingApiHandler
  const requests: { method: string; url: string }[] = []
  const server = serve({
    fetch: (request) => {
      requests.push({ method: request.method, url: request.url })
      return handler(request)
    },
    hostname: '127.0.0.1',
    port: 0,
  }) as Server
  await once(server, 'listening')

  return {
    origin: serverOrigin(server, '127.0.0.1'),
    requests,
    resetRequests() {
      requests.length = 0
    },
    setHandler(next: (request: Request) => Response | Promise<Response>) {
      handler = next
    },
    close: () => closeServer(server),
  }
}

async function startFakeEveSso(apiOrigin: string) {
  const queuedCharacters: FakeEveCharacter[] = []
  const proofByCode = new Map<string, FakeEveCharacter>()
  const app = new Hono().get('/authorize', (context) => {
    const character = queuedCharacters.shift()
    const state = context.req.query('state')
    if (!character || !state) return context.text('No deterministic EVE proof was queued.', 400)
    const code = randomUUID()
    proofByCode.set(code, character)
    const callback = new URL('/auth/eve/callback', apiOrigin)
    callback.searchParams.set('state', state)
    callback.searchParams.set('code', code)
    return context.redirect(callback.toString())
  })
  const server = serve({ fetch: app.fetch, hostname: 'localhost', port: 0 }) as Server
  await once(server, 'listening')

  return {
    origin: serverOrigin(server, 'localhost'),
    queue(character: FakeEveCharacter) {
      queuedCharacters.push(character)
    },
    exchange(code: string) {
      const character = proofByCode.get(code)
      if (!character) throw new Error('Unknown deterministic EVE authorization code')
      return {
        access_token: `fake-access:${code}`,
        refresh_token: `fake-refresh:${code}`,
        expires_in: 1200,
        token_type: 'Bearer',
      }
    },
    verify(accessToken: string) {
      const character = proofByCode.get(accessToken.slice('fake-access:'.length))
      if (!character) throw new Error('Unknown deterministic EVE access token')
      return {
        characterId: character.characterId,
        characterName: character.characterName,
        scopes: character.scopes,
      }
    },
    affiliation(characterId: number) {
      const character = [...proofByCode.values()].find(
        (candidate) => candidate.characterId === characterId,
      )
      if (!character) throw new Error('Unknown deterministic EVE character')
      return { corporationId: character.corporationId, allianceId: character.allianceId }
    },
    reset() {
      queuedCharacters.length = 0
      proofByCode.clear()
    },
    close: () => closeServer(server),
  }
}

function serverOrigin(server: Server, hostname: string) {
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Test server did not bind a TCP port')
  return `http://${hostname}:${address.port}`
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

async function waitForDatabase(connection: postgres.Sql) {
  // Readiness attempts must be serialized against one connection.
  // oxlint-disable no-await-in-loop
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await connection`select 1`
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  // oxlint-enable no-await-in-loop
  throw new Error('PostgreSQL test container did not become ready')
}
