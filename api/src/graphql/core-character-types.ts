export const coreCharacterTypeDefs = /* GraphQL */ `
  type Query {
    ownedCharacters(first: Int! = 50, after: String): OwnedCharacterConnection
    ownedCharacter(characterId: EveId!): OwnedCharacter
  }
  type OwnedCharacterConnection {
    items: [OwnedCharacterIdentity!]!
    pageInfo: PageInfo!
  }
  type OwnedCharacterIdentity {
    characterId: EveId!
    name: String!
    isMain: Boolean!
  }
  type OwnedCharacter {
    characterId: EveId!
    name: String!
    isMain: Boolean!
    assets(first: Int! = 25, after: String): AssetConnection
  }
  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
    restartRequired: Boolean!
  }
  type AssetConnection {
    characterId: EveId!
    assets: [Asset!]!
    sourcePage: Int!
    totalSourcePages: Int!
    anchor: String!
    anchorSource: AssetSource!
    source: AssetSource!
    pageInfo: PageInfo!
    completeness: String!
    enrichment: AssetEnrichment!
  }
  type AssetSource {
    validatedAt: UTCTime!
    cachedUntil: UTCTime!
    stale: Boolean!
    retryAt: UTCTime
    refreshFailureClass: String
  }
  type AssetEnrichment {
    types: String!
    names: String!
    locations: String!
  }
  type Asset {
    itemId: EveId!
    typeId: EveId!
    quantity: BigInteger!
    isSingleton: Boolean!
    isBlueprintCopy: Boolean
    parentItemId: EveId
    locationId: EveId!
    locationType: String!
    locationFlag: String!
    typeName: String!
    groupId: EveId
    groupName: String
    categoryId: EveId
    categoryName: String
    unitVolume: Float
    totalVolume: Float
    customName: String
    locationName: String
    solarSystemId: EveId
    solarSystemSecurityStatus: Float
  }
`
