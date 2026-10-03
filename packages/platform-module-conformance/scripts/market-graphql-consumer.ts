import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const writeMarketGraphQLConsumerFixture = async (
  repositoryRoot: string,
  consumerRoot: string,
) => {
  const installedSource = await readFile(
    join(consumerRoot, 'node_modules/@eve-space/market-nuxt/src/runtime/app/market-graphql.ts'),
    'utf8',
  )
  await writeFile(join(consumerRoot, 'market-generated.ts'), installedSource)
  const fixture = await readFile(
    join(repositoryRoot, 'features/market/nuxt/test/types/graphql.ts'),
    'utf8',
  )
  await writeFile(
    join(consumerRoot, 'src/market-graphql.ts'),
    fixture.replace(
      '../../src/runtime/app/market-graphql.js',
      '../node_modules/@eve-space/market-nuxt/src/runtime/app/market-graphql.js',
    ),
  )
  await writeFile(
    join(consumerRoot, 'market-graphql-smoke.mjs'),
    `import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { executeTypedGraphQL } from '@eve-space/platform-module-nuxt/runtime'
import { MarketProfilesDocument, marketGraphQLIdentity } from './compiled/market-generated.js'

assert.equal(marketGraphQLIdentity.length, 2)
assert.ok(marketGraphQLIdentity.every(identity => identity.length === 64))
const operationSource = await readFile(new URL('./node_modules/@eve-space/market-nuxt/src/runtime/app/market-operations.graphql', import.meta.url), 'utf8')
assert.equal(marketGraphQLIdentity[1], createHash('sha256').update(operationSource).digest('hex'))
globalThis.fetch = async (url, init) => {
  assert.equal(url, 'https://api.example.test/api/graphql')
  assert.equal(init.method, 'POST')
  const body = JSON.parse(init.body)
  assert.equal(body.query, MarketProfilesDocument.toString())
  assert.deepEqual(body.variables, {})
  return Response.json({ data: { market: { profiles: [] } } })
}
const result = await executeTypedGraphQL('https://api.example.test', MarketProfilesDocument, {})
assert.deepEqual(result.data, { market: { profiles: [] } })
`,
  )
}
