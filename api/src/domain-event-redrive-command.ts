const maximumDomainEventRedriveLimit = 1_000
const domainEventRedriveFlags = new Set(['--dry-run', '--confirm-queue-discard'])
const domainEventRedriveValueArguments = new Set(['--from', '--to', '--time-field', '--limit'])

interface DomainEventRedriveOptions {
  from: Date
  to: Date
  limit: number
  timeField: 'occurredAt' | 'publishedAt'
}

export interface DomainEventRedriveCommandOptions extends DomainEventRedriveOptions {
  dryRun: boolean
  queueDiscardConfirmed: boolean
}

interface DomainEventRedriveDependencies {
  count(options: DomainEventRedriveOptions): Promise<number>
  select(options: DomainEventRedriveOptions): Promise<string[]>
  assertQueueJobsAbsent(eventIds: readonly string[]): Promise<void>
  redrive(eventIds: readonly string[]): Promise<string[]>
}

export function parseDomainEventRedriveArgs(
  args: readonly string[],
): DomainEventRedriveCommandOptions {
  const commandArgs = args[0] === '--' ? args.slice(1) : args
  const values = new Map<string, string>()
  const flags = new Set<string>()

  for (let index = 0; index < commandArgs.length;) {
    const argument = commandArgs[index]!
    if (domainEventRedriveFlags.has(argument)) {
      addUniqueFlag(flags, argument)
      index += 1
      continue
    }
    collectValueArgument(argument, commandArgs[index + 1], values)
    index += 2
  }

  const from = parseTimestamp(requiredValue(values, '--from'), '--from')
  const to = parseTimestamp(requiredValue(values, '--to'), '--to')
  if (from >= to) throw new Error('--from must be before --to')

  const selector = requiredValue(values, '--time-field')
  if (selector !== 'occurrence' && selector !== 'publication')
    throw new Error('--time-field must be occurrence or publication')

  const limitValue = requiredValue(values, '--limit')
  if (!/^\d+$/.test(limitValue)) throw new Error('--limit must be an integer')
  const limit = Number(limitValue)
  if (limit < 1 || limit > maximumDomainEventRedriveLimit)
    throw new Error(`--limit must be between 1 and ${maximumDomainEventRedriveLimit}`)

  return {
    from,
    to,
    limit,
    timeField: selector === 'occurrence' ? 'occurredAt' : 'publishedAt',
    dryRun: flags.has('--dry-run'),
    queueDiscardConfirmed: flags.has('--confirm-queue-discard'),
  }
}

export async function runDomainEventRedriveCommand(
  options: DomainEventRedriveCommandOptions,
  dependencies: DomainEventRedriveDependencies,
) {
  const storeOptions: DomainEventRedriveOptions = {
    from: options.from,
    to: options.to,
    limit: options.limit,
    timeField: options.timeField,
  }
  if (options.dryRun) {
    return { dryRun: true as const, matched: await dependencies.count(storeOptions) }
  }
  if (!options.queueDiscardConfirmed) throw new Error('Mutation requires --confirm-queue-discard')

  const selectedIds = await dependencies.select(storeOptions)
  await dependencies.assertQueueJobsAbsent(selectedIds)
  const eventIds = await dependencies.redrive(selectedIds)
  return { dryRun: false as const, redriven: eventIds.length, eventIds }
}

function requiredValue(values: ReadonlyMap<string, string>, argument: string) {
  const value = values.get(argument)
  if (!value) throw new Error(`Missing required argument: ${argument}`)
  return value
}

function addUniqueFlag(flags: Set<string>, argument: string) {
  if (flags.has(argument)) throw new Error(`Duplicate argument: ${argument}`)
  flags.add(argument)
}

function collectValueArgument(
  argument: string,
  value: string | undefined,
  values: Map<string, string>,
) {
  if (!domainEventRedriveValueArguments.has(argument))
    throw new Error(`Unknown argument: ${argument}`)
  if (values.has(argument)) throw new Error(`Duplicate argument: ${argument}`)

  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`)
  values.set(argument, value)
}

function parseTimestamp(value: string, argument: string) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    )
  if (!match) throw new Error(`${argument} must be an ISO-8601 timestamp with a timezone`)
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) throw new Error(`${argument} must be a valid timestamp`)
  const offsetMinutes =
    match[8] === 'Z'
      ? 0
      : (match[9] === '+' ? 1 : -1) * (Number(match[10]) * 60 + Number(match[11]))
  const localTimestamp = new Date(timestamp.getTime() + offsetMinutes * 60_000)
  const expected = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
    Number((match[7] ?? '').padEnd(3, '0')),
  ]
  const actual = [
    localTimestamp.getUTCFullYear(),
    localTimestamp.getUTCMonth() + 1,
    localTimestamp.getUTCDate(),
    localTimestamp.getUTCHours(),
    localTimestamp.getUTCMinutes(),
    localTimestamp.getUTCSeconds(),
    localTimestamp.getUTCMilliseconds(),
  ]
  if (expected.some((component, index) => component !== actual[index]))
    throw new Error(`${argument} must be a valid timestamp`)
  return timestamp
}
