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
        typeId: 34,
        typeName: 'Tritanium',
        description: '<p>The main building block&nbsp;of space structures.</p>',
        groupId: 18,
        groupName: 'Mineral',
        categoryId: 4,
        categoryName: 'Material',
        attributeId: 180,
        attributeValue: 167,
      }),
    )
    const { getUniverseTypeDetails } = await import('../../src/universe/type-details.js')

    await expect(getUniverseTypeDetails(34)).resolves.toEqual({
      typeId: 34,
      name: 'Tritanium',
      description: 'The main building block of space structures.',
      group: { id: 18, name: 'Mineral' },
      category: { id: 4, name: 'Material' },
      detail: null,
    })
    expect(mocks.limit).toHaveBeenCalledWith(3)
    expect(Object.keys(mocks.select.mock.calls[0]![0])).toEqual([
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
    expect(new PgDialect().sqlToQuery(mocks.leftJoin.mock.calls[0]![1]).params).toEqual([
      180, 181, 275,
    ])
    expect(new PgDialect().sqlToQuery(mocks.where.mock.calls[0]![0]).params).toEqual([
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

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      detail: {
        kind: 'skill',
        rank: 3.5,
        primaryAttribute: 'perception',
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
          rank: null,
          primaryAttribute: null,
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
        rank: null,
        primaryAttribute: null,
        secondaryAttribute: null,
      },
    })
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
    typeId: 3300,
    typeName: 'Gunnery',
    description: '<b>Operation of weapon systems.</b>',
    typePublished: true,
    groupId: 255,
    groupName: 'Gunnery',
    groupPublished: true,
    categoryId: 16,
    categoryName: 'Skill',
    categoryPublished: true,
    attributeId: null,
    attributeValue: null,
    ...overrides,
  }
}
