import {
  definePlatformGraphQLRead,
  type PlatformGraphQLReadCapabilities,
} from '@eve-space/platform-module-contract/graphql'
import { z } from 'zod'
import {
  readEnabledMarketProfiles,
  readMarketBookState,
  readMarketOrderPage,
} from './book-reads.js'
import { decodeMarketOrderCursor, encodeMarketOrderCursor } from './order-cursor.js'
import { MarketReadError, marketReadId, marketReadInput, marketReadPageSize } from './read-input.js'

type ProfilePersistence = Parameters<typeof readEnabledMarketProfiles>[0]
type BookPersistence = Parameters<typeof readMarketBookState>[0]
type OrderPersistence = ProfilePersistence & Parameters<typeof readMarketOrderPage>[0]
type ProfileCapabilities = PlatformGraphQLReadCapabilities<readonly [], ProfilePersistence>
type BookCapabilities = PlatformGraphQLReadCapabilities<readonly [], BookPersistence>
type OrderCapabilities = PlatformGraphQLReadCapabilities<
  readonly ['static-location-labels'],
  OrderPersistence
>

const bookInput = z.strictObject({ profileId: z.uuid(), typeId: marketReadId })
const orderInput = z.strictObject(bookInput.shape).safeExtend({
  observationId: z.uuid(),
  side: z.enum(['sell', 'buy']),
  first: marketReadPageSize,
  after: z
    .string()
    .min(1)
    .max(1024)
    .nullish()
    .transform((cursor) => cursor ?? undefined),
})

export const profilesRead = definePlatformGraphQLRead<ProfileCapabilities>(
  async ({ capabilities }) => {
    const profiles = await readEnabledMarketProfiles(capabilities.persistence)
    capabilities.cache.publicUntil(new Date(Date.now() + 30_000).toISOString(), 30)
    return profiles
  },
)

export const bookRead = definePlatformGraphQLRead<BookCapabilities>(
  async ({ args, capabilities }) => {
    const { profileId, typeId } = marketReadInput(bookInput, args)
    const state = await readMarketBookState(capabilities.persistence, profileId, typeId)
    if (!state) throw new MarketReadError('MARKET_PROFILE_UNAVAILABLE', 404)
    if (state.status === 'current' && !state.replacement && state.observation)
      capabilities.cache.publicUntil(state.observation.freshUntil, 10)
    else capabilities.cache.noStore()
    return { profileId, typeId, ...state }
  },
)

export const ordersRead = definePlatformGraphQLRead<OrderCapabilities>(
  async ({ args, capabilities }) => {
    const { first, after, ...selector } = marketReadInput(orderInput, args)
    const cursor = decodeMarketOrderCursor(after, selector)
    const profiles = await readEnabledMarketProfiles(capabilities.persistence)
    const profile = profiles.find((entry) => entry.profileId === selector.profileId)
    if (!profile) throw new MarketReadError('MARKET_PROFILE_UNAVAILABLE', 404)
    const page = await readMarketOrderPage(
      capabilities.persistence,
      capabilities.coreData,
      selector.profileId,
      {
        ...cursor,
        observationId: selector.observationId,
        typeId: selector.typeId,
        side: selector.side,
        limit: first,
      },
    )
    if (!page) throw new MarketReadError('MARKET_OBSERVATION_UNAVAILABLE', 404)
    const last = page.rows.at(-1)
    const nextCursor = page.hasMore && last ? encodeMarketOrderCursor(selector, last) : null
    if (page.labelsComplete && Date.parse(page.observation.freshUntil) > Date.now())
      capabilities.cache.publicUntil(page.observation.freshUntil, 10)
    else capabilities.cache.noStore()
    return { ...page, profileRevision: profile.revision, nextCursor }
  },
)
