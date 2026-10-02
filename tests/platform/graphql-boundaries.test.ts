import { describe, expect, it } from 'vitest'
import { graphQLImportViolations } from '../../scripts/graphql-boundaries.js'

describe('GraphQL dependency boundaries', () => {
  it('accepts the host seam and pure scalar module', () => {
    expect(
      graphQLImportViolations([
        {
          path: 'api/src/graphql/host-adapter.ts',
          source: "import { Hono } from 'hono'; import './execution-policy.js'",
        },
        {
          path: 'api/src/graphql/scalars.ts',
          source: "import { GraphQLScalarType } from 'graphql'",
        },
      ]),
    ).toEqual([])
  })

  it('rejects domain imports of transports and undeclared infrastructure', () => {
    const issues = graphQLImportViolations([
      {
        path: 'api/src/graphql/scalars.ts',
        source: "import './host-adapter.js'; import '../db/client.js'",
      },
      { path: 'api/src/graphql/host-adapter.ts', source: "import './scalars.js'" },
    ])
    expect(issues.some((issue) => issue.includes('host-adapter.js'))).toBe(true)
    expect(issues.some((issue) => issue.includes('../db/client.js'))).toBe(true)
    expect(issues.some((issue) => issue.includes('dependency cycle'))).toBe(true)
  })

  it('rejects an undeclared module', () => {
    expect(graphQLImportViolations([{ path: 'api/src/graphql/unknown.ts', source: '' }])).toEqual([
      'api/src/graphql/unknown.ts: undeclared GraphQL module',
    ])
  })

  it('keeps execution policy independent of transport integration', () => {
    expect(
      graphQLImportViolations([
        {
          path: 'api/src/graphql/execution-policy.ts',
          source: "import type { Plugin } from 'graphql-yoga'",
        },
      ]),
    ).toEqual(['api/src/graphql/execution-policy.ts: forbidden GraphQL dependency graphql-yoga'])
  })
})
