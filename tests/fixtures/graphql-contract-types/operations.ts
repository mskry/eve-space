import {
  ExplorerMarketDocument,
  ExplorerMarketBookDocument,
  ExplorerOwnedAssetsDocument,
  type ExplorerOwnedAssetsQueryVariables,
  type ExplorerMarketQuery,
  type ExplorerMarketBookQuery,
} from '../../../app/generated/graphql-operations.js'
import { executeTypedGraphQL } from '@eve-space/platform-module-nuxt/runtime'

const variables: ExplorerOwnedAssetsQueryVariables = {
  characterId: '9007199254740993',
  first: 25,
  after: null,
}
void executeTypedGraphQL('http://localhost', ExplorerOwnedAssetsDocument, variables)
void executeTypedGraphQL('http://localhost', ExplorerMarketDocument, {})
void executeTypedGraphQL('http://localhost', ExplorerMarketBookDocument, {
  profileId: '00000000-0000-4000-8000-000000000001',
  typeId: '34',
})

// @ts-expect-error EVE identities are exact strings.
const numericIdentity: ExplorerOwnedAssetsQueryVariables = { characterId: 7001 }
// @ts-expect-error Owned-assets operations require an explicit character identity.
void executeTypedGraphQL('http://localhost', ExplorerOwnedAssetsDocument, {})
// @ts-expect-error Unknown variables do not belong to the curated operation.
const extraVariable: ExplorerOwnedAssetsQueryVariables = { characterId: '7001', userId: 'caller' }
// @ts-expect-error Market book operations require an explicit profile identity.
void executeTypedGraphQL('http://localhost', ExplorerMarketBookDocument, { typeId: '34' })
void executeTypedGraphQL('http://localhost', ExplorerMarketBookDocument, {
  profileId: 'profile',
  // @ts-expect-error Market type identities are exact strings.
  typeId: 34,
})

const referencePrice = (result: ExplorerMarketQuery): string | null | undefined =>
  result.market?.referencePrices?.rows[0]?.averagePriceIsk
const historyPrice = (result: ExplorerMarketBookQuery): string | undefined =>
  result.market?.history?.days[0]?.averageIsk
void [numericIdentity, extraVariable, referencePrice, historyPrice]
