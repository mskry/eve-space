import type { PlatformActivityProvider } from '@eve-space/platform-module-contract/activity'
import type { PlatformPersistenceMethodsFor } from '@eve-space/platform-module-contract/persistence'
import {
  definePlatformSingleRequestResource,
  type PlatformResourceOperationContract,
} from '@eve-space/platform-module-contract/resources'
import type { PlatformModuleRouteCapabilities } from '@eve-space/platform-module-contract/server'
import { definePlatformPersistenceOperation } from '@eve-space/platform-module-server'
import { Hono } from 'hono'
import { z } from 'zod'

export const readFixtureOperation = definePlatformPersistenceOperation({
  id: 'read-fixture',
  inputSchema: z.strictObject({ id: z.string() }),
  maximumInputBytes: 128,
  maximumOutputBytes: 128,
  method: 'readFixture',
  mode: 'read',
  outputSchema: z.strictObject({ value: z.string() }),
  revision: 1,
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

type FixtureProtocol = {
  readonly 'fixture-status': PlatformResourceOperationContract<
    Readonly<Record<string, never>>,
    unknown
  >
}

export const fixtureResource = definePlatformSingleRequestResource<
  'fixture-status',
  FixtureProtocol,
  unknown
>({
  map: ({ data }) => data,
  async materialize() {},
  mode: 'single-request',
  operation: 'fixture-status',
  request: () => ({}),
})

export function fixtureProvider(): PlatformActivityProvider {
  return async () => ({ activities: [], freshness: { collectedAt: null, state: 'current' } })
}
