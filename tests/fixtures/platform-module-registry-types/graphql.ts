import {
  definePlatformGraphQLRead,
  type PlatformGraphQLReadCapabilities,
  type PlatformGraphQLContribution,
} from '@eve-space/platform-module-contract/graphql'

type Capabilities = PlatformGraphQLReadCapabilities<
  readonly ['market-catalogue'],
  { readValue(input: { id: string }): Promise<string> }
>

definePlatformGraphQLRead<Capabilities>(async ({ capabilities, subject }) => {
  await capabilities.coreData.marketCatalogue({ kind: 'revision' })
  await capabilities.persistence.readValue({ id: 'value' })
  void subject?.characterId
  // @ts-expect-error Undeclared core products are absent.
  void capabilities.coreData.publicCharacterProfile
  // @ts-expect-error Read capabilities grant no collection scheduling.
  void capabilities.schedule
  // @ts-expect-error Persistence exposes only the declared method.
  void capabilities.persistence.writeValue
  return null
})

const unsupported = {
  id: 'root',
  field: 'Query.fixture',
  cost: 1,
  sourceCost: 0,
  persistenceOperations: [],
  coreDataProducts: [],
  // @ts-expect-error Administrator strategies cannot contribute GraphQL reads.
  strategy: 'deployment-administrator',
} satisfies PlatformGraphQLContribution['reads'][number]
void unsupported
