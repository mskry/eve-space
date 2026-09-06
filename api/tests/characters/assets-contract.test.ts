import { hc, type InferResponseType } from 'hono/client'
import { describe, expectTypeOf, test } from 'vitest'
import type { AppType } from '../../src/index.js'

const client = hc<AppType>('http://localhost:8788')
const character = client.api.me.characters[':characterId']

type AssetsResponse = InferResponseType<(typeof character.assets)['$get'], 200>
type Asset = AssetsResponse['assets'][number]
type HasAnyKey<Value, Keys extends PropertyKey> = [Extract<keyof Value, Keys>] extends [never]
  ? false
  : true

describe('mounted Assets AppType contract', () => {
  test('preserves character identity, nullable enrichment, and freshness semantics', () => {
    expectTypeOf<AssetsResponse['characterId']>().toEqualTypeOf<number>()
    expectTypeOf<AssetsResponse['cachedUntil']>().toEqualTypeOf<string>()
    expectTypeOf<AssetsResponse['validatedAt']>().toEqualTypeOf<string>()
    expectTypeOf<AssetsResponse['stale']>().toEqualTypeOf<boolean>()
    expectTypeOf<AssetsResponse['refreshFailureClass']>().toEqualTypeOf<
      'esi-cooldown' | 'esi-unavailable' | 'response-invalid' | 'unknown' | undefined
    >()
    expectTypeOf<AssetsResponse['enrichment']['types']>().toEqualTypeOf<
      'complete' | 'partial' | 'unavailable'
    >()
    expectTypeOf<Asset['isBlueprintCopy']>().toEqualTypeOf<boolean | null>()
    expectTypeOf<Asset['customName']>().toEqualTypeOf<string | null>()
    expectTypeOf<Asset['locationName']>().toEqualTypeOf<string | null>()
    expectTypeOf<Asset['parentItemId']>().toEqualTypeOf<number | null>()
    expectTypeOf<Asset['unitVolume']>().toEqualTypeOf<number | null>()
    expectTypeOf<Asset['totalVolume']>().toEqualTypeOf<number | null>()
  })

  test('exposes only the intentional camelCase asset record', () => {
    expectTypeOf<Asset>().toEqualTypeOf<{
      itemId: number
      typeId: number
      typeName: string
      groupId: number | null
      groupName: string | null
      categoryId: number | null
      categoryName: string | null
      unitVolume: number | null
      totalVolume: number | null
      quantity: number
      isSingleton: boolean
      isBlueprintCopy: boolean | null
      customName: string | null
      locationId: number
      locationType: 'station' | 'solar_system' | 'item' | 'other'
      locationName: string | null
      locationFlag: string
      parentItemId: number | null
    }>()
    expectTypeOf<
      HasAnyKey<AssetsResponse, 'source' | 'quota' | 'data' | 'meta' | 'accessToken' | 'token'>
    >().toEqualTypeOf<false>()
    expectTypeOf<
      HasAnyKey<
        Asset,
        | 'item_id'
        | 'type_id'
        | 'location_id'
        | 'location_type'
        | 'location_flag'
        | 'is_singleton'
        | 'is_blueprint_copy'
        | 'position'
        | 'x'
        | 'y'
        | 'z'
        | 'structureId'
        | 'structureOwnerId'
        | 'accessToken'
        | 'refreshToken'
      >
    >().toEqualTypeOf<false>()
  })

  test('does not expose corporation or alliance Assets routes', () => {
    expectTypeOf<
      HasAnyKey<(typeof client.api.corporations)[':corporationId'], 'assets'>
    >().toEqualTypeOf<false>()
    expectTypeOf<HasAnyKey<typeof client.api, 'alliances'>>().toEqualTypeOf<false>()
  })
})
