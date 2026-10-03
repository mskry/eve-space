import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { buildSchema, graphql, isScalarType } from 'graphql'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { applicationScalars } from '../../../../api/src/graphql/scalars.js'
import type { TradingInventoryFilters } from '../src/runtime/app/trading-graphql'

const schema = buildSchema(
  await readFile(
    new URL('../../../../api/src/generated/graphql/application.graphql', import.meta.url),
    'utf8',
  ),
)
for (const [name, scalar] of Object.entries(applicationScalars)) {
  const target = schema.getType(name)
  if (isScalarType(target)) {
    target.serialize = scalar.serialize
    target.parseValue = scalar.parseValue
    target.parseLiteral = scalar.parseLiteral
  }
}
export const requests: {
  path: string
  body?: { query?: string; variables?: FixtureInventoryArguments; scope?: string }
}[] = []
interface FixtureInventoryArguments {
  readonly characterIds?: readonly string[] | null
  readonly corporationId?: string | null
  readonly filters?: TradingInventoryFilters | null
  readonly first?: number
  readonly after?: string | null
  readonly groupKey?: string
}
type FixtureInventorySelection = string | readonly string[] | readonly number[] | null
export const controls = {
  reviewer: true,
  authenticated: true,
  admissionUnavailable: false,
  revision: 1,
  delay: 0,
  restart: false,
  disabled: false,
  empty: false,
  gap: 'authorization-required',
  limit: false,
}
const owner = '11111111-1111-4111-8111-111111111111'
const clock = {
  observationId: 'fixture-observation',
  observedAt: '2026-10-03T10:00:00.000Z',
  validatedAt: '2026-10-03T10:05:00.000Z',
  freshUntil: '2099-10-03T10:15:00.000Z',
  retainedUntil: '2099-10-04T10:05:00.000Z',
}
const fingerprint = (scope: string, ids: FixtureInventorySelection) =>
  createHash('sha256')
    .update(JSON.stringify([owner, scope, ids, controls.revision]))
    .digest('hex')
const character = (id: number) => ({
  characterId: id,
  name: `Trading Pilot ${id}`,
  corporationId: 98,
  allianceId: null,
  scopes: ['esi-assets.read_assets.v1'],
  isMain: id === 7,
})
const admission = () => ({
  userId: owner,
  characters: [7, 8, 9].map((characterId) => ({
    characterId,
    admissionRevision: 'fixture-character',
  })),
  organization: null,
})
const selectedCharacters = (scope: string, ids: FixtureInventorySelection): number[] => {
  if (Array.isArray(ids) && ids.length === 0) return []
  if (scope === 'personal' && Array.isArray(ids)) return ids.map(Number)
  return [7, 8, 9]
}
const selectedQuantity = (scope: string, selected: readonly number[]) => {
  if (scope === 'corporation') return '55'
  if (selected.includes(7) && selected.includes(8)) return '12'
  if (selected.includes(7)) return '5'
  return '7'
}
const fixtureGroups = (empty: boolean, quantity: string, args: FixtureInventoryArguments) => {
  const rows = empty
    ? []
    : Array.from({ length: 51 }, (_, i) => ({
        key: `[${34 + i},"none","station:60000001"]`,
        typeId: 34 + i,
        typeName: i === 0 ? 'Tritanium' : `Trading material ${i}`,
        groupId: 18,
        categoryId: 4,
        blueprint: 'none',
        location: {
          key: 'station:60000001',
          id: 60000001,
          name: 'Trading depot',
          state: 'resolved',
        },
        currentQuantity: quantity,
        staleQuantity: i === 0 ? '2' : '0',
      }))
  const filtered = rows.filter(
    (row) =>
      (!args.filters?.typeId || String(row.typeId) === args.filters.typeId) &&
      (!args.filters?.groupId || String(row.groupId) === args.filters.groupId) &&
      (!args.filters?.categoryId || String(row.categoryId) === args.filters.categoryId) &&
      (!args.filters?.locationKey || row.location.key === args.filters.locationKey),
  )
  return {
    rows: args.after ? filtered.slice(50) : filtered.slice(0, args.first),
    endCursor: 'fixture-next-groups',
    hasNextPage: !args.after && filtered.length > 50,
  }
}
const fixtureCoverage = (selected: readonly number[]) => {
  const gap = selected.includes(9) && !controls.empty
  return {
    coverageCounts: {
      includedCurrent: selected.filter((id) => id !== 9).length,
      includedStale: 0,
      authorizationRequired: gap && controls.gap === 'authorization-required' ? 1 : 0,
      neverCollected: 0,
      unavailable: gap && controls.gap === 'unavailable' ? 1 : 0,
      incomplete: 0,
      beyondRetention: 0,
      conflictingSource: gap && controls.gap === 'conflicting-source' ? 1 : 0,
    },
    coverage: {
      rows: selected.map((id) => ({
        characterId: id,
        characterName: `Trading Pilot ${id}`,
        state: id === 9 && gap ? controls.gap : 'included-current',
        source: id === 9 && gap ? null : clock,
      })),
      endCursor: null,
      hasNextPage: false,
    },
  }
}
const scopeResult = (scope: string, args: FixtureInventoryArguments) => {
  if (!controls.authenticated)
    throw Object.assign(new Error('Authentication required'), {
      extensions: { code: 'AUTH_REQUIRED', status: 401 },
    })
  if (scope === 'corporation' && !controls.reviewer)
    throw Object.assign(new Error('Reviewer permission required'), {
      extensions: { code: 'ORGANIZATION_PERMISSION_REQUIRED', status: 403 },
    })
  const ids = scope === 'corporation' ? (args.corporationId ?? null) : (args.characterIds ?? null)
  const selected = selectedCharacters(scope, ids)
  const empty = selected.length === 0
  const quantity = selectedQuantity(scope, selected)
  return {
    version: 1,
    scope,
    corporationId: scope === 'corporation' ? args.corporationId : null,
    fingerprint: fingerprint(scope, ids),
    traversalComplete: true,
    sourcesComplete: empty || controls.empty || !selected.includes(9),
    expectedSubjects: selected.length,
    ...fixtureCoverage(selected),
    groups: fixtureGroups(empty || controls.empty, quantity, args),
    holders: {
      rows: selected
        .filter((id: number) => id !== 9)
        .map((id: number) => ({
          characterId: id,
          characterName: `Trading Pilot ${id}`,
          userId: owner,
          groupKey: args.groupKey,
          currentQuantity: id === 7 ? '5' : '7',
          staleQuantity: '0',
          source: clock,
        })),
      endCursor: null,
      hasNextPage: false,
    },
  }
}
const root = {
  trading: () => ({
    personalInventory: async (args: FixtureInventoryArguments) => {
      const value = scopeResult('personal', args)
      if (controls.delay) await new Promise((resolve) => setTimeout(resolve, controls.delay))
      return value
    },
    corporationInventory: (args: FixtureInventoryArguments) => scopeResult('corporation', args),
  }),
}
export const fixture = new Hono()
  .use('*', cors({ origin: 'http://127.0.0.1:3003', credentials: true }))
  .use('*', async (context, next) => {
    const body = context.req.method === 'POST' ? await context.req.raw.clone().json() : undefined
    requests.push({ path: context.req.path, body })
    await next()
  })
  .get('/api/e2e/public-esi', (context) =>
    context.json({ marker: 'PUBLIC_ESI_FIXTURE', text: 'Trading storage positive control' }),
  )
  .get('/auth/config', (context) =>
    context.json({ configured: true, loginUrl: '/login', attachUrl: '/attach' }),
  )
  .get('/auth/session', (context) =>
    context.json(
      controls.authenticated
        ? {
            authenticated: true,
            account: { userId: owner, mainCharacter: character(7) },
            cacheAdmission: admission(),
          }
        : { authenticated: false },
    ),
  )
  .get('/api/me/cache-admission', (context) => context.json(admission()))
  .get('/api/me/characters', (context) => context.json({ characters: [7, 8, 9].map(character) }))
  .get('/api/organization/context', (context) =>
    context.json({ memberAccess: false, organization: { organizationVersion: 1 } }),
  )
  .get('/api/modules', (context) =>
    context.json({
      enabledModuleIds: controls.disabled ? [] : ['trading', 'member-audit'],
      enabledSections: [
        {
          moduleId: 'member-audit',
          sectionId: 'assets',
          kind: 'sensitive-evidence',
          disclosureVersion: 1,
          activationVersion: 1,
        },
      ],
      shellNavigationOrder: { dashboard: [], character: [] },
    }),
  )
  .get('/api/inventory/corporations', (context) =>
    controls.reviewer && controls.authenticated
      ? context.json({ admitted: true, corporations: [98] })
      : context.json({ code: 'ORGANIZATION_PERMISSION_REQUIRED' }, 403),
  )
  .post('/api/inventory/admission', async (context) => {
    if (controls.admissionUnavailable) return context.json({ message: 'Unavailable' }, 503)
    if (!controls.authenticated) return context.json({ code: 'AUTH_REQUIRED' }, 401)
    const input = await context.req.json()
    if (input.scope === 'corporation' && !controls.reviewer)
      return context.json({ code: 'ORGANIZATION_PERMISSION_REQUIRED' }, 403)
    return context.json({
      admitted: true,
      ownerId: owner,
      fingerprint: fingerprint(
        input.scope,
        input.scope === 'corporation'
          ? String(input.corporationId)
          : (input.characterIds?.map(String) ?? null),
      ),
      validForMilliseconds: 60_000,
    })
  })
  .post('/graphql', async (context) => {
    context.header('Cache-Control', 'private, no-store')
    const { query, variables } = await context.req.json()
    if (controls.limit)
      return context.json({
        errors: [{ message: 'Scope limit', extensions: { code: 'INVENTORY_LIMIT', status: 400 } }],
      })
    if (controls.restart && variables.after)
      return context.json({
        errors: [
          {
            message: 'Source changed',
            extensions: { code: 'INVENTORY_SOURCE_CHANGED', status: 409 },
          },
        ],
      })
    return context.json(
      await graphql({ schema, source: query, variableValues: variables, rootValue: root }),
    )
  })
