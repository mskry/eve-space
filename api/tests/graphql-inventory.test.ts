import { beforeEach, expect, test, vi } from 'vitest'
import { parse, print, separateOperations } from 'graphql'
import { readFile } from 'node:fs/promises'
import type { InventoryBrowserSelection } from '../src/platform/inventory-browser-admission.js'

interface InventoryPersistenceFixtureInput {
  readonly subjects: readonly { readonly characterId: number }[]
  readonly kind?: string
}

const boundary = vi.hoisted(() => ({
  session: vi.fn(),
  owned: vi.fn(),
  page: vi.fn(),
  enrich: vi.fn(),
  enabled: vi.fn(),
  authorize: vi.fn(),
  viewer: vi.fn(),
  candidates: vi.fn(),
  policy: vi.fn(),
  sourceSubjects: vi.fn(),
  sources: vi.fn(),
  rows: vi.fn(),
  audit: vi.fn(),
  nested: vi.fn(),
  corporations: vi.fn(),
}))
vi.mock('../src/auth/session-store.js', async (original) => ({
  ...(await original<object>()),
  findSession: boundary.session,
}))
vi.mock('../src/organization/inventory-corporations.js', () => ({
  listInventoryCorporations: boundary.corporations,
}))
vi.mock('../src/middleware/auth-session.js', async (original) => ({
  ...(await original<object>()),
  readRequestSession: boundary.session,
}))
vi.mock('../src/auth/inventory-subject-store.js', () => ({
  loadPersonalInventorySubjects: boundary.owned,
}))
vi.mock('../src/characters/asset-pages.js', async (original) => ({
  ...(await original<object>()),
  loadCharacterAssetPage: boundary.page,
}))
vi.mock('../src/characters/inventory-enrichment.js', () => ({
  enrichInventoryItems: boundary.enrich,
}))
vi.mock('../src/platform/module-settings.js', async (original) => ({
  ...(await original<object>()),
  isInstalledModuleContributionEnabled: boundary.enabled,
}))
vi.mock('../src/organization/session-context.js', () => ({
  loadOrganizationSessionContext: boundary.viewer,
}))
vi.mock('../src/organization/module-authorization.js', async (original) => ({
  ...(await original<object>()),
  authorizeOrganizationReviewerContribution: boundary.authorize,
}))
vi.mock('../src/organization/inventory-subject-store.js', () => ({
  loadInventoryOrganizationPolicy: boundary.policy,
  resolveCorporationInventorySubjects: boundary.candidates,
}))
vi.mock('../src/platform/inventory-source-admission.js', () => ({
  loadCorporationInventorySourceSubjects: boundary.sourceSubjects,
}))
vi.mock('../src/platform/inventory-access-audit.js', () => ({
  recordInventoryAccessDecision: boundary.audit,
}))
vi.mock('../src/platform/module-route-capabilities.js', async (original) => {
  const actual = await original<typeof import('../src/platform/module-route-capabilities.js')>()
  return {
    ...actual,
    createPlatformModuleReadCapabilities: (
      ...args: Parameters<typeof actual.createPlatformModuleReadCapabilities>
    ) => {
      boundary.nested(args[0])
      return actual.createPlatformModuleReadCapabilities(...args)
    },
  }
})
vi.mock('../src/db/module-persistence-operation-transaction.js', () => ({
  createStandaloneModulePersistenceOperationInvoker:
    () => async (operation: { operationId: string }, input: InventoryPersistenceFixtureInput) => {
      if (operation.operationId === 'read-inventory-sources') return boundary.sources(input)
      if (operation.operationId === 'read-asset-inventory') return boundary.rows(input)
      throw new Error('Unexpected private operation')
    },
}))

import { app } from '../src/index.js'
import { applicationGraphQLSchema, applicationGraphQLPolicies } from '../src/graphql/schema.js'
import { analyzeGraphQLSelection } from '../src/graphql/execution-policy.js'

const actor = '11111111-1111-4111-8111-111111111111'
const life = '22222222-2222-4222-8222-222222222222'
const observation = '33333333-3333-4333-8333-333333333333'
const groupKey = '[34,"none","station:60000001"]'
const now = new Date().toISOString()
const future = new Date(Date.now() + 3600_000).toISOString()
const subject = (characterId: number) => ({
  characterId,
  characterName: `Pilot ${characterId}`,
  userId: actor,
  characterLifecycle: life,
  authorizationRevision: 7,
  scopes: ['esi-assets.read_assets.v1'],
  pendingAttemptId: null,
})
const corpSubject = (characterId: number, readable = true) => ({
  ...subject(characterId),
  corporationId: 98,
  memberLifecycle: life,
  affiliationPeriodRevision: 'period',
  authorizationGeneration: 7,
  disclosureRevision: 1,
  sectionActivationRevision: 1,
  evidenceReadable: readable,
  coverage: readable ? null : 'authorization-required',
  observationId: null,
  collection: { state: 'current', validatedAt: now, freshUntil: future, lastFailureClass: null },
})
const group = {
  key: groupKey,
  typeId: 34,
  typeName: 'Tritanium',
  groupId: 18,
  categoryId: 4,
  blueprint: 'none',
  location: { key: 'station:60000001', id: '60000001', name: null, state: 'unknown' },
  currentQuantity: '12',
  staleQuantity: '0',
}
const request = async (selection: string, signal?: AbortSignal) => {
  const response = await app.request('/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
    body: JSON.stringify({ query: `{ trading { ${selection} } }` }),
    signal,
  })
  return { response, body: await response.json() }
}
const groups =
  'expectedSubjects sourcesComplete coverageCounts { includedCurrent authorizationRequired } groups { endCursor hasNextPage rows { key typeId currentQuantity staleQuantity } }'
const coverage =
  'expectedSubjects coverageCounts { includedCurrent authorizationRequired } coverage { endCursor hasNextPage rows { characterId state source { observationId } } }'

beforeEach(() => {
  vi.resetAllMocks()
  boundary.session.mockResolvedValue({
    userId: actor,
    mainCharacter: { characterId: 1, name: 'Actor', corporationId: 98, allianceId: null },
  })
  boundary.owned.mockImplementation(async (_actor, selected) =>
    [subject(1), subject(2)].filter(
      (row) => selected === undefined || selected.includes(row.characterId),
    ),
  )
  boundary.enabled.mockResolvedValue(true)
  boundary.page.mockImplementation(async (id, _life, page) => ({
    authorizationGeneration: 7,
    data: {
      page,
      totalPages: 1,
      assets: [
        {
          itemId: id * 100,
          typeId: 34,
          quantity: id === 1 ? 5 : 7,
          isSingleton: false,
          isBlueprintCopy: null,
          locationId: 60000001,
          locationType: 'station',
          locationFlag: 'Hangar',
          parentItemId: null,
        },
      ],
    },
    validatedAt: now,
    cachedUntil: future,
    readableUntil: future,
    stale: false,
  }))
  boundary.enrich.mockResolvedValue({
    types: new Map([[34, { typeName: 'Tritanium', groupId: 18, categoryId: 4 }]]),
    locations: new Map(),
  })
  boundary.viewer.mockResolvedValue({ organizationVersion: 3, state: 'compliant', blocked: false })
  boundary.authorize.mockImplementation(async (_user, _viewer, declaration) => ({
    authorized: true,
    context: { organizationVersion: 3, ...declaration, entitlementScope: 'all' },
  }))
  boundary.policy.mockResolvedValue(4)
  boundary.candidates.mockResolvedValue([corpSubject(1), corpSubject(2, false), corpSubject(3)])
  boundary.sourceSubjects.mockResolvedValue([corpSubject(1), corpSubject(2, false), corpSubject(3)])
  boundary.sources.mockImplementation(async ({ subjects }) =>
    subjects.map((row: { characterId: number }) => ({
      characterId: row.characterId,
      observationId: observation,
      validatedAt: now,
      ready: true,
    })),
  )
  boundary.rows.mockImplementation(async ({ kind }) => ({
    groups: kind === 'groups' ? [group] : [],
    holders:
      kind === 'holders'
        ? [{ characterId: 1, groupKey, currentQuantity: '12', staleQuantity: '0' }]
        : [],
    hasNextPage: false,
    conflictingCharacters: [],
  }))
  boundary.audit.mockResolvedValue(undefined)
})

test('mounted personal read defaults to both owned characters and returns private exact totals', async () => {
  const { body, response } = await request(`personalInventory(first: 1) { ${groups} }`)
  expect(body.errors).toBeUndefined()
  expect(body.data.trading.personalInventory).toMatchObject({
    expectedSubjects: 2,
    sourcesComplete: true,
    groups: { rows: [{ typeId: '34', currentQuantity: '12', staleQuantity: '0' }] },
  })
  expect(response.headers.get('Cache-Control')).toMatch(/no-store/)
  expect(boundary.page).toHaveBeenCalledTimes(2)
  expect(boundary.authorize).not.toHaveBeenCalled()
  expect(boundary.sources).not.toHaveBeenCalled()
})

test('an explicit empty personal selection stays empty and unknown selections read no evidence', async () => {
  expect(
    (await request(`personalInventory(characterIds: []) { ${groups} }`)).body.data.trading
      .personalInventory.expectedSubjects,
  ).toBe(0)
  const unknown = await request(`personalInventory(characterIds: ["999"]) { ${groups} }`)
  expect(unknown.body.data.trading.personalInventory).toBeNull()
  expect(unknown.body.errors[0].extensions.code).toBe('INVENTORY_SCOPE_DENIED')
  expect(boundary.page).not.toHaveBeenCalled()
})

test('mounted corporation read binds exact source grants and preserves safe missing-scope coverage', async () => {
  const { body, response } = await request(
    `corporationInventory(corporationId: "98", first: 1) { ${groups} }`,
  )
  expect(body.errors).toBeUndefined()
  expect(body.data.trading.corporationInventory).toMatchObject({
    expectedSubjects: 3,
    sourcesComplete: false,
    coverageCounts: { includedCurrent: 2, authorizationRequired: 1 },
    groups: { rows: [{ currentQuantity: '12' }] },
  })
  expect(response.headers.get('Cache-Control')).toMatch(/no-store/)
  expect(boundary.authorize).toHaveBeenCalledWith(
    actor,
    expect.anything(),
    expect.objectContaining({
      requiredPermission: 'trading.inventory.corporation.read',
      additionalRequiredPermissions: ['member-audit.assets.read'],
    }),
  )
  expect(
    boundary.sources.mock.calls[0]![0].subjects.map(
      (row: { characterId: number }) => row.characterId,
    ),
  ).toEqual([1, 3])
  expect(boundary.audit).toHaveBeenCalledWith(
    expect.objectContaining({
      decision: 'allowed',
      subjects: expect.arrayContaining([
        expect.objectContaining({ characterId: 2, evidenceReadable: false }),
      ]),
    }),
  )
})

test('coverage keysets merge readable and coverage-only subjects without widening the provider', async () => {
  const first = (
    await request(
      `corporationInventory(corporationId: "98", kind: coverage, first: 1) { ${coverage} }`,
    )
  ).body.data.trading.corporationInventory.coverage
  expect(first.rows).toMatchObject([{ characterId: '1', state: 'included-current' }])
  const second = (
    await request(
      `corporationInventory(corporationId: "98", kind: coverage, first: 1, after: ${JSON.stringify(first.endCursor)}) { ${coverage} }`,
    )
  ).body.data.trading.corporationInventory.coverage
  expect(second.rows).toMatchObject([
    { characterId: '2', state: 'authorization-required', source: null },
  ])
  const third = (
    await request(
      `corporationInventory(corporationId: "98", kind: coverage, first: 1, after: ${JSON.stringify(second.endCursor)}) { ${coverage} }`,
    )
  ).body.data.trading.corporationInventory.coverage
  expect(third.rows).toMatchObject([{ characterId: '3', state: 'included-current' }])
  expect(third.hasNextPage).toBe(false)
})

test('mixed aliases preserve personal success when corporation authorization is denied', async () => {
  boundary.authorize.mockResolvedValue({ authorized: false, reason: 'permission' })
  const { body } = await request(
    `own: personalInventory { ${groups} } corp: corporationInventory(corporationId: "98") { ${groups} }`,
  )
  expect(body.data.trading.own.groups.rows[0].currentQuantity).toBe('12')
  expect(body.data.trading.corp).toBeNull()
  expect(body.errors[0]).toMatchObject({
    path: ['trading', 'corp'],
    extensions: { code: 'ORGANIZATION_PERMISSION_REQUIRED' },
  })
  expect(boundary.sources).not.toHaveBeenCalled()
})

test.each(['trading', 'member-audit'])(
  'module disablement at %s refuses its field before source reads',
  async (module) => {
    boundary.enabled.mockImplementation(async (id) => id !== module)
    const { body } = await request(
      `personalInventory { ${groups} } corporationInventory(corporationId: "98") { ${groups} }`,
    )
    expect(boundary.sources).not.toHaveBeenCalled()
    expect(body.data.trading === null).toBe(module === 'trading')
    expect(body.data.trading?.personalInventory?.groups.rows.length ?? null).toBe(
      module === 'trading' ? null : 1,
    )
    expect(body.data.trading?.corporationInventory ?? null).toBeNull()
    expect(boundary.page).toHaveBeenCalledTimes(module === 'trading' ? 0 : 2)
  },
)

test('serves 20 complete thousand-item personal sources under the mounted operation budget', async () => {
  boundary.owned.mockResolvedValue(Array.from({ length: 20 }, (_, index) => subject(index + 1)))
  boundary.page.mockImplementation(async (id, _life, page) => ({
    authorizationGeneration: 7,
    data: {
      page,
      totalPages: 1,
      assets: Array.from({ length: 1000 }, (_, index) => ({
        itemId: id * 10_000 + index,
        typeId: 34,
        quantity: 3,
        isSingleton: false,
        isBlueprintCopy: null,
        locationId: 60000001,
        locationType: 'station',
        locationFlag: 'Hangar',
        parentItemId: null,
      })),
    },
    validatedAt: now,
    cachedUntil: future,
    readableUntil: future,
    stale: false,
  }))
  const before = process.memoryUsage()
  const started = performance.now()
  const { body, response } = await request(`personalInventory(first: 100) { ${groups} }`)
  const durationMilliseconds = performance.now() - started
  expect(body.errors).toBeUndefined()
  expect(body.data.trading.personalInventory).toMatchObject({
    expectedSubjects: 20,
    sourcesComplete: true,
    coverageCounts: { includedCurrent: 20 },
    groups: { rows: [{ currentQuantity: '60000', staleQuantity: '0' }] },
  })
  expect(boundary.page).toHaveBeenCalledTimes(20)
  expect(response.headers.get('Cache-Control')).toMatch(/no-store/)
  console.info(
    'Trading personal capacity',
    JSON.stringify({
      subjects: 20,
      sourceRows: 20_000,
      sourceCalls: boundary.page.mock.calls.length,
      durationMilliseconds,
      responseBytes: Buffer.byteLength(JSON.stringify(body)),
      heapDeltaBytes: process.memoryUsage().heapUsed - before.heapUsed,
      rssDeltaBytes: process.memoryUsage().rss - before.rss,
      processPeakRssKiB: process.resourceUsage().maxRSS,
    }),
  )
})

test('holder access uses the same bound scope and records only selected holder attribution', async () => {
  const { body } = await request(
    `corporationInventory(corporationId: "98", kind: holders, groupKey: ${JSON.stringify(groupKey)}) { holders { rows { characterId currentQuantity source { observationId } } } }`,
  )
  expect(body.errors).toBeUndefined()
  expect(body.data.trading.corporationInventory.holders.rows).toMatchObject([
    { characterId: '1', currentQuantity: '12' },
  ])
  expect(boundary.audit).toHaveBeenCalledWith(
    expect.objectContaining({
      accessKind: 'holders',
      decision: 'allowed',
      subjects: [expect.objectContaining({ characterId: 1 })],
    }),
  )
})

test('audit failure refuses corporation evidence', async () => {
  boundary.audit.mockRejectedValue(new Error('private storage detail'))
  const { body } = await request(`corporationInventory(corporationId: "98") { ${groups} }`)
  expect(body.data.trading.corporationInventory).toBeNull()
  expect(body.errors[0].extensions.code).toBe('INTERNAL_SERVER_ERROR')
  expect(JSON.stringify(body)).not.toContain('private storage detail')
})

test.each(['malformed', 'oversized', 'scope', 'filter', 'authority'])(
  'refuses a %s cursor before personal evidence reads',
  async (change) => {
    const first = (await request(`personalInventory(first: 1) { ${groups} }`)).body.data.trading
      .personalInventory.groups.endCursor
    boundary.page.mockClear()
    let cursor = first
    let selector = ''
    if (change === 'malformed') cursor = 'bad'
    if (change === 'oversized') cursor = 'a'.repeat(4097)
    if (change === 'scope') selector = 'characterIds: ["1"],'
    if (change === 'filter') selector = 'filters: {typeId: "34"},'
    if (change === 'authority')
      boundary.owned.mockResolvedValue([{ ...subject(1), authorizationRevision: 8 }, subject(2)])
    const { body } = await request(
      `personalInventory(${selector}after: ${JSON.stringify(cursor)}) { ${groups} }`,
    )
    expect(body.data.trading.personalInventory).toBeNull()
    expect(['BAD_USER_INPUT', 'INVENTORY_RESTART_REQUIRED']).toContain(
      body.errors[0].extensions.code,
    )
    expect(boundary.page).not.toHaveBeenCalled()
  },
)

test('changed personal source identities require restart between pages', async () => {
  const first = (await request(`personalInventory(first: 1) { ${groups} }`)).body.data.trading
    .personalInventory.groups.endCursor
  boundary.page.mockResolvedValue({
    authorizationGeneration: 7,
    data: { page: 1, totalPages: 1, assets: [] },
    validatedAt: now,
    cachedUntil: future,
    readableUntil: future,
    stale: false,
  })
  const { body } = await request(`personalInventory(after: ${JSON.stringify(first)}) { ${groups} }`)
  expect(body.data.trading.personalInventory).toBeNull()
  expect(body.errors[0].extensions.code).toBe('INVENTORY_RESTART_REQUIRED')
})

test('a replaced corporation observation refuses the old cursor', async () => {
  const first = (await request(`corporationInventory(corporationId: "98", first: 1) { ${groups} }`))
    .body.data.trading.corporationInventory.groups.endCursor
  boundary.sources.mockImplementation(async ({ subjects }) =>
    subjects.map((row: { characterId: number }) => ({
      characterId: row.characterId,
      observationId: life,
      validatedAt: now,
      ready: true,
    })),
  )
  const { body } = await request(
    `corporationInventory(corporationId: "98", after: ${JSON.stringify(first)}) { ${groups} }`,
  )
  expect(body.data.trading.corporationInventory).toBeNull()
  expect(body.errors[0].extensions.code).toBe('INVENTORY_RESTART_REQUIRED')
})

test('authority loss during source work refuses release', async () => {
  boundary.enrich.mockImplementation(async () => {
    boundary.owned.mockResolvedValue([subject(1)])
    return { types: new Map(), locations: new Map() }
  })
  const { body } = await request(`personalInventory { ${groups} }`)
  expect(body.data.trading.personalInventory).toBeNull()
  expect(body.errors[0].extensions.code).toBe('INVENTORY_AUTHORIZATION_CHANGED')
})

test('nested rows retain corporation admission after the aggregate resolver finishes', async () => {
  boundary.nested.mockImplementation((declaration) => {
    if (declaration.contributionId.endsWith('/group-rows'))
      boundary.authorize.mockResolvedValue({ authorized: false, reason: 'permission' })
  })
  const { body } = await request(`corporationInventory(corporationId: "98") { ${groups} }`)
  expect(body.data.trading.corporationInventory).toBeNull()
  expect(body.errors[0]).toMatchObject({
    path: ['trading', 'corporationInventory', 'groups', 'rows'],
    extensions: { code: 'ORGANIZATION_PERMISSION_REQUIRED' },
  })
})

test('expiry between personal pages requires restart and never restores old totals', async () => {
  const first = (await request(`personalInventory(first: 1) { ${groups} }`)).body.data.trading
    .personalInventory.groups.endCursor
  const expired = new Date(Date.now() - 1).toISOString()
  boundary.page.mockResolvedValue({
    authorizationGeneration: 7,
    data: { page: 1, totalPages: 1, assets: [] },
    validatedAt: now,
    cachedUntil: expired,
    readableUntil: expired,
    stale: false,
  })
  const { body } = await request(`personalInventory(after: ${JSON.stringify(first)}) { ${groups} }`)
  expect(body.data.trading.personalInventory).toBeNull()
  expect(body.errors[0].extensions.code).toBe('INVENTORY_RESTART_REQUIRED')
})

test('canceling a source stops admitting the remaining characters', async () => {
  const controller = new AbortController()
  boundary.page.mockImplementation(async () => {
    controller.abort()
    throw controller.signal.reason
  })
  const { body } = await request(`personalInventory { ${groups} }`, controller.signal)
  expect(body.data?.trading?.personalInventory ?? null).toBeNull()
  expect(boundary.page).toHaveBeenCalledTimes(1)
})

test('small output pages still reject a scope above twenty characters', async () => {
  boundary.owned.mockResolvedValue(Array.from({ length: 21 }, (_, i) => subject(i + 1)))
  const { body } = await request(`personalInventory(first: 1) { ${groups} }`)
  expect(body.errors[0].extensions.code).toBe('INVENTORY_LIMIT')
  expect(boundary.page).not.toHaveBeenCalled()
})

const documents = separateOperations(
  parse(
    await readFile(
      new URL(
        '../../features/trading/nuxt/src/runtime/app/trading-operations.graphql',
        import.meta.url,
      ),
      'utf8',
    ),
  ),
)
test.each(Object.entries(documents))(
  'generated %s stays private and fits the unchanged operation budget',
  (operationName, document) => {
    const verdict = analyzeGraphQLSelection(
      applicationGraphQLSchema,
      print(document),
      operationName,
      {
        corporationId: '98',
        groupKey,
        first: 100,
        characterIds: null,
      },
      applicationGraphQLPolicies,
    )
    expect(verdict.private).toBe(true)
    expect(verdict.cost).toBeLessThanOrEqual(5000)
    expect(verdict.rows).toBeLessThanOrEqual(1000)
  },
)

test('twenty ordinary subjects succeed without changing backend or output limits', async () => {
  boundary.owned.mockResolvedValue(Array.from({ length: 20 }, (_, i) => subject(i + 1)))
  const { body } = await request(`personalInventory(first: 1) { ${groups} }`)
  expect(body.errors).toBeUndefined()
  expect(body.data.trading.personalInventory).toMatchObject({
    expectedSubjects: 20,
    groups: { rows: [{ currentQuantity: '138' }] },
  })
  expect(boundary.page).toHaveBeenCalledTimes(20)
})

test('independent aliases share the backend ceiling even with one output row', async () => {
  boundary.page.mockImplementation(async (id, _life, page) => ({
    authorizationGeneration: 7,
    data: {
      page,
      totalPages: 10,
      assets: [
        {
          itemId: id * 100 + page,
          typeId: 34,
          quantity: 1,
          isSingleton: false,
          isBlueprintCopy: null,
          locationId: 60000001,
          locationType: 'station',
          locationFlag: 'Hangar',
          parentItemId: null,
        },
      ],
    },
    validatedAt: now,
    cachedUntil: future,
    readableUntil: future,
    stale: false,
  }))
  const { body } = await request(
    `a: personalInventory(first: 1) { expectedSubjects } b: personalInventory(characterIds: ["1"], first: 1) { expectedSubjects } c: personalInventory(characterIds: ["2"], first: 1) { expectedSubjects }`,
  )
  expect(
    body.errors.some(
      (error: { extensions: { code: string } }) => error.extensions.code === 'OPERATION_LIMIT',
    ),
  ).toBe(true)
  expect(body.data).toBeNull()
  expect(boundary.page.mock.calls.length).toBeLessThanOrEqual(32)
})

test('readable stale sources retain unaffected quantities when coverage reports an item conflict', async () => {
  const expired = new Date(Date.now() - 60_000).toISOString()
  boundary.page.mockImplementation(async (id) => ({
    authorizationGeneration: 7,
    data: {
      page: 1,
      totalPages: 1,
      assets: [
        {
          itemId: 100,
          typeId: 34,
          quantity: 5,
          isSingleton: false,
          isBlueprintCopy: null,
          locationId: 60000001,
          locationType: 'station',
          locationFlag: 'Hangar',
          parentItemId: null,
        },
        {
          itemId: id * 1000,
          typeId: 34,
          quantity: 7,
          isSingleton: false,
          isBlueprintCopy: null,
          locationId: 60000001,
          locationType: 'station',
          locationFlag: 'Hangar',
          parentItemId: null,
        },
      ],
    },
    validatedAt: now,
    cachedUntil: expired,
    readableUntil: future,
    stale: true,
    refreshFailureClass: 'esi-unavailable',
  }))
  const { body } = await request(
    'personalInventory { sourcesComplete coverageCounts { conflictingSource } groups { rows { currentQuantity staleQuantity } } }',
  )
  expect(body.errors).toBeUndefined()
  expect(body.data.trading.personalInventory).toMatchObject({
    sourcesComplete: false,
    coverageCounts: { conflictingSource: 2 },
    groups: { rows: [{ currentQuantity: '0', staleQuantity: '14' }] },
  })
})

const browserAdmission = (selection: InventoryBrowserSelection) =>
  app.request('/api/inventory/admission', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
      Cookie: 'eve_space_session=fixture',
    },
    body: JSON.stringify(selection),
  })

test('browser admission returns only owner and scope metadata without asset evidence', async () => {
  const response = await browserAdmission({ scope: 'personal' })
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect(await response.json()).toEqual({
    admitted: true,
    ownerId: actor,
    fingerprint: expect.stringMatching(/^[\da-f]{64}$/),
    validForMilliseconds: 60_000,
  })
  expect(boundary.page).not.toHaveBeenCalled()
  expect(boundary.sources).not.toHaveBeenCalled()
})

test('browser admission refuses a changed subject binding before metadata release', async () => {
  boundary.owned.mockResolvedValueOnce([subject(1), subject(2)]).mockResolvedValueOnce([subject(1)])
  const response = await browserAdmission({ scope: 'personal' })
  expect(response.status).toBe(409)
  expect((await response.json()).code).toBe('INVENTORY_AUTHORIZATION_CHANGED')
  expect(boundary.page).not.toHaveBeenCalled()
})

test('browser corporation discovery requires exact live reviewer admission and reads no inventory', async () => {
  boundary.corporations.mockResolvedValue([98, 99])
  const response = await app.request('/api/inventory/corporations', {
    headers: { Cookie: 'eve_space_session=fixture' },
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ admitted: true, corporations: [98, 99] })
  expect(boundary.corporations).toHaveBeenCalledWith(3)
  expect(boundary.sources).not.toHaveBeenCalled()
  boundary.authorize.mockResolvedValue({ authorized: false, reason: 'permission' })
  boundary.corporations.mockClear()
  const denied = await app.request('/api/inventory/corporations', {
    headers: { Cookie: 'eve_space_session=fixture' },
  })
  expect(denied.status).toBe(403)
  expect(boundary.corporations).not.toHaveBeenCalled()
})
