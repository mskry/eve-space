import { hc, type InferResponseType } from 'hono/client'
import { describe, expectTypeOf, test } from 'vitest'
import type { AppType } from '../../src/index.js'

const client = hc<AppType>('http://localhost:8788')
const character = client.api.me.characters[':characterId']

type ClonesResponse = InferResponseType<(typeof character.clones)['$get'], 200>
type ImplantsResponse = InferResponseType<(typeof character.implants)['$get'], 200>
type JumpClone = ClonesResponse['jumpClones'][number]
type Implant = ImplantsResponse['implants'][number]
type HasAnyKey<Value, Keys extends PropertyKey> = [Extract<keyof Value, Keys>] extends [never]
  ? false
  : true

describe('mounted Clones AppType contract', () => {
  test('preserves nullable locations, dates, and root freshness metadata', () => {
    expectTypeOf<ClonesResponse['homeLocation']>().toMatchTypeOf<{
      locationId: number | null
      locationType: 'station' | 'structure' | null
      name: string | null
    } | null>()
    expectTypeOf<ClonesResponse['lastCloneJumpAt']>().toEqualTypeOf<string | null>()
    expectTypeOf<ClonesResponse['lastStationChangeAt']>().toEqualTypeOf<string | null>()
    expectTypeOf<ClonesResponse['stale']>().toEqualTypeOf<boolean>()
    expectTypeOf<ImplantsResponse['validatedAt']>().toEqualTypeOf<string>()
  })

  test('preserves stable clone and implant identities without raw ESI fields', () => {
    expectTypeOf<JumpClone['jumpCloneId']>().toEqualTypeOf<number>()
    expectTypeOf<JumpClone['name']>().toEqualTypeOf<string | null>()
    expectTypeOf<Implant>().toEqualTypeOf<{
      typeId: number
      name: string
      slot: number | null
      bonuses: Array<{
        attribute: 'charisma' | 'intelligence' | 'memory' | 'perception' | 'willpower'
        value: number
      }>
    }>()
    expectTypeOf<
      HasAnyKey<ClonesResponse, 'source' | 'quota' | 'data' | 'meta' | 'jump_clones'>
    >().toEqualTypeOf<false>()
    expectTypeOf<
      HasAnyKey<JumpClone, 'jump_clone_id' | 'implantTypeIds' | 'location_id' | 'location_type'>
    >().toEqualTypeOf<false>()
  })

  test('does not expose a fatigue route through the application contract', () => {
    expectTypeOf<HasAnyKey<typeof character, 'fatigue'>>().toEqualTypeOf<false>()
  })
})
