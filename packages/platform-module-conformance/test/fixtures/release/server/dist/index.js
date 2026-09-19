import { Hono } from 'hono'
import { definePlatformPersistenceOperation } from '@eve-space/platform-module-server'
import { z } from 'zod'

export const readFixtureOperation = definePlatformPersistenceOperation({
  id: 'read-fixture',
  method: 'readFixture',
  revision: 1,
  mode: 'read',
  inputSchema: z.strictObject({ id: z.string() }),
  outputSchema: z.strictObject({ value: z.string() }),
  maximumInputBytes: 128,
  maximumOutputBytes: 128,
})
export function fixtureRoutes(capabilities) {
  return new Hono().get('/', async (context) => context.json(await capabilities.persistence.readFixture({ id: 'fixture' })))
}
export function fixtureProvider() {
  return async () => ({ activities: [], freshness: { state: 'current', collectedAt: null } })
}
