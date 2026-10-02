// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { generateGraphQLArtifacts, graphqlArtifactPaths } from '../../scripts/graphql-generation'

const root = new URL('../..', import.meta.url)
const installed = await readFile(
  fileURLToPath(new URL('api/src/generated/platform/installed-module-graphql.graphql', root)),
  'utf8',
)
const documents = await readFile(
  fileURLToPath(new URL('app/graphql/operations.graphql', root)),
  'utf8',
)

describe('offline GraphQL generation', () => {
  it('generates deterministic artifacts without server credentials', async () => {
    const first = await generateGraphQLArtifacts(installed, documents)
    expect(await generateGraphQLArtifacts(installed, documents)).toEqual(first)
  })

  it('detects schema and operation drift and rejects unknown scalars and invalid documents', async () => {
    const initial = await generateGraphQLArtifacts(installed, documents)
    const changedSchema = await generateGraphQLArtifacts(
      `${installed}\nextend type MarketRead { added: String }`,
      documents,
    )
    expect(changedSchema.get(graphqlArtifactPaths.schema)).not.toEqual(
      initial.get(graphqlArtifactPaths.schema),
    )
    const changedDocument = await generateGraphQLArtifacts(
      installed,
      documents.replace('ingestedAt', 'keyAlias: key'),
    )
    expect(changedDocument.get(graphqlArtifactPaths.operations)).not.toEqual(
      initial.get(graphqlArtifactPaths.operations),
    )
    await expect(generateGraphQLArtifacts(installed, 'query { absentField }')).rejects.toThrow(
      'Cannot query field',
    )
    await expect(
      generateGraphQLArtifacts(
        `${installed}\nscalar Unmapped\nextend type MarketRead { added: Unmapped }`,
        documents,
      ),
    ).rejects.toThrow('Unmapped')
  })
})
