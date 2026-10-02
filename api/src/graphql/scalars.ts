import { GraphQLError, GraphQLScalarType, Kind } from 'graphql'

type StringCoercion = GraphQLScalarType<string, string>['parseValue']

const invalidScalar = (): never => {
  throw new GraphQLError('Invalid scalar value.', { extensions: { code: 'BAD_USER_INPUT' } })
}

const exactString = (value: Parameters<StringCoercion>[0]): string => {
  if (typeof value === 'string' && value.length <= 192) return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  if (typeof value === 'bigint' && value.toString().length <= 192) return value.toString()
  return invalidScalar()
}

const matchString = (value: Parameters<StringCoercion>[0], pattern: RegExp): string => {
  const result = exactString(value)
  return pattern.test(result) ? result : invalidScalar()
}

const createStringScalar = (
  name: string,
  serialize: StringCoercion,
  parseValue: StringCoercion = serialize,
) =>
  new GraphQLScalarType({
    name,
    serialize,
    parseValue,
    parseLiteral: (node) => (node.kind === Kind.STRING ? parseValue(node.value) : invalidScalar()),
  })

const eveIdValue: StringCoercion = (value) => matchString(value, /^[1-9]\d*$/)
const eveIdInput: StringCoercion = (value) =>
  typeof value === 'string' ? eveIdValue(value) : invalidScalar()
const decimalValue: StringCoercion = (value) => matchString(value, /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/)
const integerValue: StringCoercion = (value) => matchString(value, /^-?(?:0|[1-9]\d*)$/)
const uuidValue: StringCoercion = (value) =>
  matchString(value, /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i)
const dateValue: StringCoercion = (value) => {
  const result = matchString(value, /^\d{4}-\d{2}-\d{2}$/)
  const date = new Date(result)
  if (!Number.isFinite(date.valueOf())) return invalidScalar()
  return date.toISOString().slice(0, 10) === result ? result : invalidScalar()
}
const timeValue: StringCoercion = (value) => {
  const result = matchString(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/)
  const date = new Date(result)
  if (!Number.isFinite(date.valueOf())) return invalidScalar()
  const canonical = date.toISOString()
  return canonical.slice(0, 19) === result.slice(0, 19) ? result : invalidScalar()
}

const backendTimeValue: StringCoercion = (value) => {
  const text = exactString(value)
  const timestamp = text.charAt(10) === ' ' ? `${text.slice(0, 10)}T${text.slice(11)}` : text
  const result = /^[+-]\d{2}$/.test(timestamp.slice(-3)) ? `${timestamp}:00` : timestamp
  if (result.endsWith('Z')) return timeValue(result)
  const offset = result.slice(-6)
  if (!/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(offset)) return invalidScalar()
  const localTime = timeValue(`${result.slice(0, -6)}Z`)
  const date = new Date(result)
  if (!Number.isFinite(date.valueOf())) return invalidScalar()
  const fractionalSeconds = localTime.slice(19, -1)
  return `${date.toISOString().slice(0, 19)}${fractionalSeconds}Z`
}

export const applicationScalars = {
  EveId: createStringScalar('EveId', eveIdValue, eveIdInput),
  Decimal: createStringScalar('Decimal', decimalValue),
  BigInteger: createStringScalar('BigInteger', integerValue),
  UUID: createStringScalar('UUID', uuidValue),
  UTCDate: createStringScalar('UTCDate', dateValue),
  UTCTime: createStringScalar('UTCTime', backendTimeValue, timeValue),
}

export const safeEveIdNumber = (value: string): number => {
  const number = Number(eveIdInput(value))
  return Number.isSafeInteger(number) ? number : invalidScalar()
}
