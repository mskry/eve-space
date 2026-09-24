// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { apiHttpBoundaryViolations } from '../../scripts/api-http/boundaries'

const file = (path: string, source: string) => [{ path, source }]

describe('validation wrapper', () => {
  it('accepts zValidator imported from the repository wrapper', () => {
    const source = file(
      'api/src/characters/core-routes.ts',
      "import { zValidator } from '../http/validation.js'\n",
    )

    expect(apiHttpBoundaryViolations(source)).toStrictEqual([])
  })

  it('rejects zValidator imported straight from the Hono package', () => {
    const source = file(
      'api/src/characters/core-routes.ts',
      "import { zValidator } from '@hono/zod-validator'\n",
    )

    expect(apiHttpBoundaryViolations(source)).toStrictEqual([
      "api/src/characters/core-routes.ts:1: imports zValidator from '@hono/zod-validator'; use the wrapper in api/src/http/validation.ts so validation failures keep the API's JSON error contract",
    ])
  })

  it('rejects an aliased zValidator imported straight from the Hono package', () => {
    const source = file(
      'api/src/characters/core-routes.ts',
      "import { zValidator as validate } from '@hono/zod-validator'\n",
    )

    expect(apiHttpBoundaryViolations(source)).toStrictEqual([
      "api/src/characters/core-routes.ts:1: imports zValidator from '@hono/zod-validator'; use the wrapper in api/src/http/validation.ts so validation failures keep the API's JSON error contract",
    ])
  })

  it('rejects zValidator imported straight from the platform package', () => {
    const source = file(
      'api/src/mail/routes.ts',
      "import { zValidator } from '@eve-space/platform-module-server'\n",
    )

    expect(apiHttpBoundaryViolations(source)).toHaveLength(1)
  })

  it('allows the wrapper itself to re-export from the platform package', () => {
    const source = file(
      'api/src/http/validation.ts',
      "import { zValidator } from '@eve-space/platform-module-server'\n",
    )

    expect(apiHttpBoundaryViolations(source)).toStrictEqual([])
  })

  it('ignores an unrelated import from the same package', () => {
    const source = file(
      'api/src/mail/routes.ts',
      "import { definePlatformModule } from '@eve-space/platform-module-server'\n",
    )

    expect(apiHttpBoundaryViolations(source)).toStrictEqual([])
  })
})

describe('cookie ownership', () => {
  it('allows the cookie module to use hono/cookie', () => {
    const source = file(
      'api/src/http/auth-cookie.ts',
      "import { deleteCookie, getCookie, setCookie } from 'hono/cookie'\n",
    )

    expect(apiHttpBoundaryViolations(source)).toStrictEqual([])
  })

  it('rejects any other module reaching for hono/cookie', () => {
    const source = file('api/src/auth/routes.ts', "import { setCookie } from 'hono/cookie'\n")

    expect(apiHttpBoundaryViolations(source)).toStrictEqual([
      'api/src/auth/routes.ts:1: imports hono/cookie directly; set, read, and delete cookies through api/src/http/auth-cookie.ts so HttpOnly, SameSite, Secure, and the __Host- prefix are preserved',
    ])
  })

  it('ignores the unrelated hono root import', () => {
    const source = file('api/src/auth/routes.ts', "import { Hono } from 'hono'\n")

    expect(apiHttpBoundaryViolations(source)).toStrictEqual([])
  })
})

describe('typed route outcomes', () => {
  it('allows the root not-found handler registration', () => {
    const source = file(
      'api/src/index.ts',
      'app.notFound((context) => context.json(routeNotFoundBody, 404))\n',
    )

    expect(apiHttpBoundaryViolations(source)).toStrictEqual([])
  })

  it('rejects context.notFound() as a route outcome', () => {
    const source = file(
      'api/src/characters/core-routes.ts',
      'const handler = (context) => context.notFound()\n',
    )

    expect(apiHttpBoundaryViolations(source)).toStrictEqual([
      'api/src/characters/core-routes.ts:1: returns context.notFound(); return an explicit JSON status so the outcome stays in the typed route contract',
    ])
  })

  it('allows an explicit json 404', () => {
    const source = file(
      'api/src/characters/core-routes.ts',
      "const handler = (context) => context.json({ code: 'NOT_FOUND' }, 404)\n",
    )

    expect(apiHttpBoundaryViolations(source)).toStrictEqual([])
  })
})

describe('reporting', () => {
  it('reports every violation in one file', () => {
    const source = file(
      'api/src/auth/routes.ts',
      [
        "import { zValidator } from '@hono/zod-validator'",
        "import { setCookie } from 'hono/cookie'",
        'const handler = (context) => context.notFound()',
      ].join('\n'),
    )

    expect(apiHttpBoundaryViolations(source)).toHaveLength(3)
  })

  it('sorts violations so output is stable across runs', () => {
    const source = [
      ...file('api/src/b.ts', "import { setCookie } from 'hono/cookie'\n"),
      ...file('api/src/a.ts', "import { setCookie } from 'hono/cookie'\n"),
    ]
    const violations = apiHttpBoundaryViolations(source)

    expect(violations).toStrictEqual(
      [...violations].toSorted((left, right) => left.localeCompare(right)),
    )
  })
})
