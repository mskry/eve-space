import { describe, expect, it } from 'vitest'
import { applicationScalars, safeEveIdNumber } from '../src/graphql/scalars.js'

describe('lossless GraphQL scalars', () => {
  it('preserves large IDs, integers and domain decimal scale', () => {
    expect(applicationScalars.EveId.serialize('9007199254740993')).toBe('9007199254740993')
    expect(applicationScalars.EveId.serialize(4_294_967_296)).toBe('4294967296')
    expect(applicationScalars.Decimal.serialize('999999999999999.99')).toBe('999999999999999.99')
    expect(applicationScalars.Decimal.serialize('12.123456789')).toBe('12.123456789')
    expect(applicationScalars.BigInteger.serialize(9007199254740993n)).toBe('9007199254740993')
    expect(safeEveIdNumber('4294967296')).toBe(4_294_967_296)
  })

  it.each([0, -1, '01', '1.1', '1e3', '', null, 9007199254740992])(
    'rejects unsafe ID %s',
    (value) => {
      expect(() => applicationScalars.EveId.parseValue(value)).toThrow('Invalid scalar value.')
    },
  )

  it('rejects unsafe numeric backend money and invalid dates', () => {
    expect(() => applicationScalars.Decimal.serialize(123.45)).toThrow('Invalid scalar value.')
    expect(() => safeEveIdNumber('9007199254740993')).toThrow('Invalid scalar value.')
    expect(() => applicationScalars.UTCDate.parseValue('2026-02-30')).toThrow(
      'Invalid scalar value.',
    )
    expect(applicationScalars.UTCDate.serialize('2026-10-01')).toBe('2026-10-01')
    expect(applicationScalars.UTCTime.serialize('2026-10-01T10:00:00Z')).toBe(
      '2026-10-01T10:00:00Z',
    )
  })

  it.each([
    '2026-02-30T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-10-01T24:00:00Z',
    '2026-10-01T00:00:00+00:00',
  ])('rejects noncanonical UTC time %s', (value) => {
    expect(() => applicationScalars.UTCTime.parseValue(value)).toThrow('Invalid scalar value.')
  })

  it('rejects long adversarial scalar near matches', () => {
    expect(() => applicationScalars.Decimal.parseValue(`${'1'.repeat(100_000)}.`)).toThrow(
      'Invalid scalar value.',
    )
    expect(() => applicationScalars.UUID.parseValue(`${'a'.repeat(100_000)}-`)).toThrow(
      'Invalid scalar value.',
    )
    expect(() => applicationScalars.UTCDate.parseValue('2026-99-99')).toThrow(
      'Invalid scalar value.',
    )
  })

  it('normalizes database timestamp offsets while preserving submillisecond source precision', () => {
    expect(applicationScalars.UTCTime.serialize('2026-10-01 10:00:00.123456+00')).toBe(
      '2026-10-01T10:00:00.123456Z',
    )
    expect(applicationScalars.UTCTime.serialize('2026-10-01T10:00:00.123456+00:00')).toBe(
      '2026-10-01T10:00:00.123456Z',
    )
    expect(applicationScalars.UTCTime.serialize('2026-10-01T10:00:00+02:00')).toBe(
      '2026-10-01T08:00:00Z',
    )
    expect(() => applicationScalars.UTCTime.serialize('2026-02-30T10:00:00+00:00')).toThrow(
      'Invalid scalar value.',
    )
  })
})

it('preserves scalar nulls through GraphQL and rejects oversized bigint values', async () => {
  const { createSchema } = await import('graphql-yoga')
  const { graphql } = await import('graphql')
  const schema = createSchema({
    typeDefs: 'scalar Decimal type Query { price: Decimal }',
    resolvers: { Decimal: applicationScalars.Decimal, Query: { price: () => null } },
  })
  expect(await graphql({ schema, source: '{ price }' })).toMatchObject({ data: { price: null } })
  expect(() => applicationScalars.BigInteger.serialize(BigInt('1'.repeat(193)))).toThrow(
    'Invalid scalar value.',
  )
})
