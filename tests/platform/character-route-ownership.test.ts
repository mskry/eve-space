// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { characterRouteOwnershipViolations } from '../../scripts/character-routes/ownership'

const route = (body: string, path = 'api/src/characters/core-routes.ts') => [
  { path, source: `export const routes = new Hono()\n  ${body}\n` },
]

const compliant = `.get(
    '/:characterId/wallet',
    privateNoStore,
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => context.json({}),
  )`

describe('character route ownership', () => {
  it('accepts a route that validates the parameter and loads ownership after the session', () => {
    expect(characterRouteOwnershipViolations(route(compliant))).toStrictEqual([])
  })

  it('ignores routes that are not character-ID scoped', () => {
    const source = route(`.get('/', loadSession, async (context) => context.json({}))`)

    expect(characterRouteOwnershipViolations(source)).toStrictEqual([])
  })

  it('rejects a character route with no ownership middleware', () => {
    const source = route(`.get(
    '/:characterId/wallet',
    zValidator('param', characterIdParams),
    loadSession,
    async (context) => context.json({}),
  )`)

    expect(characterRouteOwnershipViolations(source)).toStrictEqual([
      'api/src/characters/core-routes.ts:3 GET /:characterId/wallet: must load authorization through loadOwnedCharacter before its handler',
    ])
  })

  it('rejects a character route with no parameter validation', () => {
    const source = route(`.get(
    '/:characterId/wallet',
    loadSession,
    loadOwnedCharacter,
    async (context) => context.json({}),
  )`)

    expect(characterRouteOwnershipViolations(source)).toStrictEqual([
      "api/src/characters/core-routes.ts:3 GET /:characterId/wallet: must validate the character ID with zValidator('param', ...)",
    ])
  })

  it('rejects ownership loaded before the session, which always answers 401', () => {
    const source = route(`.get(
    '/:characterId/wallet',
    zValidator('param', characterIdParams),
    loadOwnedCharacter,
    loadSession,
    async (context) => context.json({}),
  )`)

    expect(characterRouteOwnershipViolations(source)).toStrictEqual([
      'api/src/characters/core-routes.ts:3 GET /:characterId/wallet: must apply loadSession before loadOwnedCharacter',
    ])
  })

  it('rejects ownership without any session middleware', () => {
    const source = route(`.get(
    '/:characterId/wallet',
    zValidator('param', characterIdParams),
    loadOwnedCharacter,
    async (context) => context.json({}),
  )`)

    expect(characterRouteOwnershipViolations(source)).toStrictEqual([
      'api/src/characters/core-routes.ts:3 GET /:characterId/wallet: must apply loadSession before loadOwnedCharacter',
    ])
  })

  it('rejects ownership middleware placed after the inline handler', () => {
    const source = route(`.get(
    '/:characterId/wallet',
    zValidator('param', characterIdParams),
    loadSession,
    async (context) => context.json({}),
    loadOwnedCharacter,
  )`)

    expect(characterRouteOwnershipViolations(source)).toStrictEqual([
      'api/src/characters/core-routes.ts:3 GET /:characterId/wallet: must load authorization through loadOwnedCharacter before its handler',
    ])
  })

  it('allows inline middleware that precedes the authorization middleware', () => {
    const source = route(`.get(
    '/:characterId/wallet',
    zValidator('param', characterIdParams),
    async (context, next) => {
      await next()
    },
    loadSession,
    loadOwnedCharacter,
    async (context) => context.json({}),
  )`)

    expect(characterRouteOwnershipViolations(source)).toStrictEqual([])
  })

  it('reports every failed requirement for one route', () => {
    const source = route(`.get('/:characterId/wallet', async (context) => context.json({}))`)

    expect(characterRouteOwnershipViolations(source)).toHaveLength(2)
  })

  it('accepts a reviewer route gated by its declared alternative', () => {
    const source = route(
      `.post(
    '/members/:userId/characters/:characterId/exception',
    requireTrustedOrigin,
    requireOrganizationHr,
    zValidator('param', characterExceptionParamsSchema),
    async (context) => context.json({}),
  )`,
      'api/src/organization/routes-review.ts',
    )

    expect(characterRouteOwnershipViolations(source)).toStrictEqual([])
  })

  it('rejects a reviewer route that drops its declared alternative gate', () => {
    const source = route(
      `.post(
    '/members/:userId/characters/:characterId/exception',
    zValidator('param', characterExceptionParamsSchema),
    async (context) => context.json({}),
  )`,
      'api/src/organization/routes-review.ts',
    )

    expect(characterRouteOwnershipViolations(source)).toStrictEqual([
      'api/src/organization/routes-review.ts:3 POST /members/:userId/characters/:characterId/exception: must load authorization through requireOrganizationHr before its handler',
    ])
  })

  it('accepts the intentionally public character route', () => {
    const source = route(
      `.get('/:characterId', zValidator('param', characterIdParams), async (context) => context.json({}))`,
      'api/src/characters/public-routes.ts',
    )

    expect(characterRouteOwnershipViolations(source)).toStrictEqual([])
  })

  it('rejects a public route that quietly starts applying ownership', () => {
    const source = route(
      `.get(
    '/:characterId',
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => context.json({}),
  )`,
      'api/src/characters/public-routes.ts',
    )

    expect(characterRouteOwnershipViolations(source)).toStrictEqual([
      'api/src/characters/public-routes.ts:3 GET /:characterId: is declared public but applies loadOwnedCharacter',
    ])
  })

  it('sorts violations so output is stable across runs', () => {
    const source = [
      ...route(`.get('/:characterId/z', async (context) => context.json({}))`, 'api/src/b.ts'),
      ...route(`.get('/:characterId/a', async (context) => context.json({}))`, 'api/src/a.ts'),
    ]
    const violations = characterRouteOwnershipViolations(source)

    expect(violations).toStrictEqual(
      [...violations].toSorted((left, right) => left.localeCompare(right)),
    )
  })
})
