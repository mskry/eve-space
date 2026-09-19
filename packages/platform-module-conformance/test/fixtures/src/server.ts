import type { PlatformActivityProvider } from '@eve-space/platform-module-contract/activity'
import type { PlatformPersistenceMethodsFor } from '@eve-space/platform-module-contract/persistence'
import { definePlatformResourceOperation } from '@eve-space/platform-module-contract/resources'
import type { PlatformModuleRouteCapabilities } from '@eve-space/platform-module-contract/server'
import { definePlatformPersistenceOperation } from '@eve-space/platform-module-server'
import { Hono } from 'hono'
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

const operations = { 'read-fixture': readFixtureOperation } as const
type FixturePersistence = PlatformPersistenceMethodsFor<
  typeof operations,
  readonly ['read-fixture']
>

export function fixtureRoutes(capabilities: PlatformModuleRouteCapabilities<FixturePersistence>) {
  return new Hono().get('/', async (context) =>
    context.json(await capabilities.persistence.readFixture({ id: 'fixture' })),
  )
}

export const fixtureResource = definePlatformResourceOperation({
  operation: 'fixture-status',
  request: () => ({}),
  map: ({ data }) => data,
  async materialize() {},
})

export function fixtureProvider(): PlatformActivityProvider {
  return async () => ({ activities: [], freshness: { state: 'current', collectedAt: null } })
}
