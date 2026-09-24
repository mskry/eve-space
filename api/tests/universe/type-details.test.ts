import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

interface TypeDetailRow {
  typeId: number
  typeName: string
  description: string | null
  typePublished: boolean
  groupId: number
  groupName: string
  groupPublished: boolean
  categoryId: number
  categoryName: string
  categoryPublished: boolean
  attributeId: number | null
  attributeValue: number | null
}

const mocks = vi.hoisted(() => ({
  categoryJoin: vi.fn(),
  from: vi.fn(),
  groupJoin: vi.fn(),
  leftJoin: vi.fn(),
  limit: vi.fn(),
  rows: [] as TypeDetailRow[],
  select: vi.fn(),
  where: vi.fn(),
}))

vi.mock('../../src/db/client.js', () => ({ db: { select: mocks.select } }))

beforeEach(() => {
  mocks.rows.splice(0)
  mocks.select.mockReturnValue({ from: mocks.from })
  mocks.from.mockReturnValue({ innerJoin: mocks.groupJoin })
  mocks.groupJoin.mockReturnValue({ innerJoin: mocks.categoryJoin })
  mocks.categoryJoin.mockReturnValue({ leftJoin: mocks.leftJoin })
  mocks.leftJoin.mockReturnValue({ where: mocks.where })
  mocks.where.mockReturnValue({ limit: mocks.limit })
  mocks.limit.mockImplementation(async () => mocks.rows)
})

describe('universe type details', () => {
  test('returns normalized generic identity without exposing Dogma rows', async () => {
    mocks.rows.push(
      row({
        attributeId: 180,
        attributeValue: 167,
        categoryId: 4,
        categoryName: 'Material',
        description: '<p>The main building block&nbsp;of space structures.</p>',
        groupId: 18,
        groupName: 'Mineral',
        typeId: 34,
        typeName: 'Tritanium',
      }),
    )
    const { getUniverseTypeDetails } = await import('../../src/universe/type-details.js')

    await expect(getUniverseTypeDetails(34)).resolves.toStrictEqual({
      category: { id: 4, name: 'Material' },
      description: 'The main building block of space structures.',
      detail: null,
      group: { id: 18, name: 'Mineral' },
      name: 'Tritanium',
      typeId: 34,
    })
    expect(mocks.limit).toHaveBeenCalledWith(9)
    expect(Object.keys(mocks.select.mock.calls[0]![0])).toStrictEqual([
      'typeId',
      'typeName',
      'description',
      'typePublished',
      'groupId',
      'groupName',
      'groupPublished',
      'categoryId',
      'categoryName',
      'categoryPublished',
      'attributeId',
      'attributeValue',
    ])
    expect(new PgDialect().sqlToQuery(mocks.leftJoin.mock.calls[0]![1]).params).toStrictEqual([
      180, 181, 275, 175, 176, 177, 178, 179, 331,
    ])
    expect(new PgDialect().sqlToQuery(mocks.where.mock.calls[0]![0]).params).toStrictEqual([
      34,
      true,
      true,
      true,
    ])
  })

  test('maps complete skill metadata independently of row order', async () => {
    const rows = [
      row({ attributeId: 181, attributeValue: 168 }),
      row({ attributeId: 275, attributeValue: 3.5 }),
      row({ attributeId: 180, attributeValue: 167 }),
    ]
    const { getUniverseTypeDetails } = await import('../../src/universe/type-details.js')

    mocks.rows.push(...rows)
    const first = await getUniverseTypeDetails(3300)
    mocks.rows.splice(0, mocks.rows.length, ...rows.toReversed())
    const second = await getUniverseTypeDetails(3300)

    expect(first).toStrictEqual(second)
    expect(first).toMatchObject({
      detail: {
        kind: 'skill',
        primaryAttribute: 'perception',
        rank: 3.5,
        secondaryAttribute: 'willpower',
      },
    })
  })

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'uses null for invalid rank value %s and unrecognized attribute pointers',
    async (rank) => {
      mocks.rows.push(
        row({ attributeId: 275, attributeValue: rank }),
        row({ attributeId: 180, attributeValue: 167.5 }),
        row({ attributeId: 181, attributeValue: 999 }),
      )
      const { getUniverseTypeDetails } = await import('../../src/universe/type-details.js')

      await expect(getUniverseTypeDetails(3300)).resolves.toMatchObject({
        detail: {
          kind: 'skill',
          primaryAttribute: null,
          rank: null,
          secondaryAttribute: null,
        },
      })
    },
  )

  test('returns a nullable skill extension when training rows are absent', async () => {
    mocks.rows.push(row({ attributeId: null, attributeValue: null }))
    const { getUniverseTypeDetails } = await import('../../src/universe/type-details.js')

    await expect(getUniverseTypeDetails(3300)).resolves.toMatchObject({
      detail: {
        kind: 'skill',
        primaryAttribute: null,
        rank: null,
        secondaryAttribute: null,
      },
    })
  })

  test('maps supported implant slot and neural bonuses in stable semantic order', async () => {
    const implantRows = [
      row({ attributeId: 179, attributeValue: 5, categoryId: 20, categoryName: 'Implant' }),
      row({ attributeId: 331, attributeValue: 3, categoryId: 20, categoryName: 'Implant' }),
      row({ attributeId: 177, attributeValue: 4, categoryId: 20, categoryName: 'Implant' }),
      row({ attributeId: 175, attributeValue: 2, categoryId: 20, categoryName: 'Implant' }),
      row({ attributeId: 178, attributeValue: -1, categoryId: 20, categoryName: 'Implant' }),
      row({ attributeId: 176, attributeValue: 3, categoryId: 20, categoryName: 'Implant' }),
    ]
    const { getUniverseTypeDetails } = await import('../../src/universe/type-details.js')

    mocks.rows.push(...implantRows)
    const first = await getUniverseTypeDetails(3300)
    mocks.rows.splice(0, mocks.rows.length, ...implantRows.toReversed())
    const second = await getUniverseTypeDetails(3300)

    expect(first).toStrictEqual(second)
    expect(first).toMatchObject({
      detail: {
        bonuses: [
          { attribute: 'charisma', value: 2 },
          { attribute: 'intelligence', value: 3 },
          { attribute: 'memory', value: 4 },
          { attribute: 'perception', value: -1 },
          { attribute: 'willpower', value: 5 },
        ],
        kind: 'implant',
        slot: 3,
      },
    })
  })

  test('returns slot-only hardwiring details without fabricating neural bonuses', async () => {
    mocks.rows.push(
      row({ attributeId: 331, attributeValue: 6, categoryId: 20, categoryName: 'Implant' }),
    )
    const { getUniverseTypeDetails } = await import('../../src/universe/type-details.js')

    await expect(getUniverseTypeDetails(3300)).resolves.toMatchObject({
      detail: { bonuses: [], kind: 'implant', slot: 6 },
    })
  })

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'keeps an implant-category type generic when slot value %s is invalid',
    async (slot) => {
      mocks.rows.push(
        row({ attributeId: 331, attributeValue: slot, categoryId: 20, categoryName: 'Implant' }),
        row({ attributeId: 175, attributeValue: 3, categoryId: 20, categoryName: 'Implant' }),
      )
      const { getUniverseTypeDetails } = await import('../../src/universe/type-details.js')

      await expect(getUniverseTypeDetails(3300)).resolves.toMatchObject({ detail: null })
    },
  )

  test('omits zero and non-finite neural bonuses from a valid implant', async () => {
    mocks.rows.push(
      row({ attributeId: 331, attributeValue: 1, categoryId: 20, categoryName: 'Implant' }),
      row({ attributeId: 175, attributeValue: 0, categoryId: 20, categoryName: 'Implant' }),
      row({
        attributeId: 176,
        attributeValue: Number.NaN,
        categoryId: 20,
        categoryName: 'Implant',
      }),
      row({
        attributeId: 177,
        attributeValue: Number.POSITIVE_INFINITY,
        categoryId: 20,
        categoryName: 'Implant',
      }),
      row({ attributeId: 179, attributeValue: 2, categoryId: 20, categoryName: 'Implant' }),
    )
    const { getUniverseTypeDetails } = await import('../../src/universe/type-details.js')

    await expect(getUniverseTypeDetails(3300)).resolves.toMatchObject({
      detail: {
        bonuses: [{ attribute: 'willpower', value: 2 }],
        kind: 'implant',
        slot: 1,
      },
    })
  })

  test('keeps a category-20 booster without implantness generic', async () => {
    mocks.rows.push(
      row({
        attributeId: null,
        attributeValue: null,
        categoryId: 20,
        categoryName: 'Implant',
        typeId: 9941,
        typeName: 'Strong Blue Pill Booster',
      }),
    )
    const { getUniverseTypeDetails } = await import('../../src/universe/type-details.js')

    await expect(getUniverseTypeDetails(9941)).resolves.toMatchObject({ detail: null })
  })

  test.each(['typePublished', 'groupPublished', 'categoryPublished'] as const)(
    'hides a row when %s is false',
    async (publishedField) => {
      mocks.rows.push(row({ [publishedField]: false }))
      const { getUniverseTypeDetails } = await import('../../src/universe/type-details.js')

      await expect(getUniverseTypeDetails(3300)).resolves.toBeNull()
    },
  )

  test('rejects inconsistent or structurally unrepresentable static rows', async () => {
    mocks.rows.push(row(), row({ groupId: 999 }))
    const { getUniverseTypeDetails } = await import('../../src/universe/type-details.js')

    await expect(getUniverseTypeDetails(3300)).resolves.toBeNull()

    mocks.rows.splice(0, mocks.rows.length, row({ categoryName: '' }))
    await expect(getUniverseTypeDetails(3300)).resolves.toBeNull()
  })

  test('propagates database failures for the route to classify', async () => {
    mocks.limit.mockRejectedValue(new Error('database connection unavailable'))
    const { getUniverseTypeDetails } = await import('../../src/universe/type-details.js')

    await expect(getUniverseTypeDetails(3300)).rejects.toThrow('database connection unavailable')
  })
})

function row(overrides: Partial<TypeDetailRow> = {}): TypeDetailRow {
  return {
    attributeId: null,
    attributeValue: null,
    categoryId: 16,
    categoryName: 'Skill',
    categoryPublished: true,
    description: '<b>Operation of weapon systems.</b>',
    groupId: 255,
    groupName: 'Gunnery',
    groupPublished: true,
    typeId: 3300,
    typeName: 'Gunnery',
    typePublished: true,
    ...overrides,
  }
}
