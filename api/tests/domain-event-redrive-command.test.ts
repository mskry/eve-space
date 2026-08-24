import { describe, expect, test, vi } from 'vitest'
import {
  parseDomainEventRedriveArgs,
  runDomainEventRedriveCommand,
} from '../src/domain-event-redrive-command.js'

const baseArgs = [
  '--from',
  '2026-08-01T00:00:00Z',
  '--to',
  '2026-08-02T00:00:00Z',
  '--time-field',
  'publication',
  '--limit',
  '100',
]

describe('domain-event re-drive command', () => {
  test('parses bounded occurrence and publication selections', () => {
    expect(parseDomainEventRedriveArgs(baseArgs)).toMatchObject({
      from: new Date('2026-08-01T00:00:00Z'),
      to: new Date('2026-08-02T00:00:00Z'),
      timeField: 'publishedAt',
      limit: 100,
      dryRun: false,
      queueDiscardConfirmed: false,
    })
    expect(
      parseDomainEventRedriveArgs([
        ...baseArgs.slice(0, 4),
        '--time-field',
        'occurrence',
        '--limit',
        '1',
      ]).timeField,
    ).toBe('occurredAt')
    expect(parseDomainEventRedriveArgs(['--', ...baseArgs]).timeField).toBe('publishedAt')
  })

  test.each([
    { args: [], message: 'Missing required argument' },
    { args: [...baseArgs.slice(0, 1), 'not-a-date', ...baseArgs.slice(2)], message: 'ISO-8601' },
    {
      args: [...baseArgs.slice(0, 1), '2026-02-30T00:00:00Z', ...baseArgs.slice(2)],
      message: 'valid timestamp',
    },
    {
      args: [
        '--from',
        '2026-08-02T00:00:00Z',
        '--to',
        '2026-08-01T00:00:00Z',
        ...baseArgs.slice(4),
      ],
      message: '--from must be before --to',
    },
    { args: [...baseArgs.slice(0, 5), 'created', ...baseArgs.slice(6)], message: 'occurrence' },
    { args: [...baseArgs.slice(0, 7), '1001'], message: 'between 1 and 1000' },
    { args: [...baseArgs, '--unknown'], message: 'Unknown argument' },
  ])('rejects malformed input: $message', ({ args, message }) => {
    expect(() => parseDomainEventRedriveArgs(args)).toThrow(message)
  })

  test('counts a dry run without requiring confirmation or mutating rows', async () => {
    const count = vi.fn().mockResolvedValue(17)
    const dependencies = redriveDependencies({ count })
    const options = parseDomainEventRedriveArgs([...baseArgs, '--dry-run'])

    await expect(runDomainEventRedriveCommand(options, dependencies)).resolves.toEqual({
      dryRun: true,
      matched: 17,
    })
    expect(count).toHaveBeenCalledWith(expect.objectContaining({ timeField: 'publishedAt' }))
    expect(dependencies.select).not.toHaveBeenCalled()
    expect(dependencies.assertQueueJobsAbsent).not.toHaveBeenCalled()
    expect(dependencies.redrive).not.toHaveBeenCalled()
  })

  test('requires queue-discard confirmation before mutation', async () => {
    const dependencies = redriveDependencies()

    await expect(
      runDomainEventRedriveCommand(parseDomainEventRedriveArgs(baseArgs), dependencies),
    ).rejects.toThrow('--confirm-queue-discard')
    expect(dependencies.select).not.toHaveBeenCalled()
    expect(dependencies.redrive).not.toHaveBeenCalled()
  })

  test('reports the original event IDs reopened by a confirmed mutation', async () => {
    const eventIds = [
      '98a782d2-e042-47d7-9659-03b218121a1a',
      '16b7570c-f6ea-43c5-9669-4692245b6667',
    ]
    const dependencies = redriveDependencies({
      select: vi.fn().mockResolvedValue(eventIds),
      redrive: vi.fn().mockResolvedValue(eventIds),
    })

    await expect(
      runDomainEventRedriveCommand(
        parseDomainEventRedriveArgs([...baseArgs, '--confirm-queue-discard']),
        dependencies,
      ),
    ).resolves.toEqual({ dryRun: false, redriven: 2, eventIds })
    expect(dependencies.assertQueueJobsAbsent).toHaveBeenCalledWith(eventIds)
    expect(dependencies.redrive).toHaveBeenCalledWith(eventIds)
  })

  test('fails closed before PostgreSQL mutation when selected jobs remain in Redis', async () => {
    const eventIds = ['98a782d2-e042-47d7-9659-03b218121a1a']
    const dependencies = redriveDependencies({
      select: vi.fn().mockResolvedValue(eventIds),
      assertQueueJobsAbsent: vi.fn().mockRejectedValue(new Error('queue jobs remain')),
    })

    await expect(
      runDomainEventRedriveCommand(
        parseDomainEventRedriveArgs([...baseArgs, '--confirm-queue-discard']),
        dependencies,
      ),
    ).rejects.toThrow('queue jobs remain')
    expect(dependencies.redrive).not.toHaveBeenCalled()
  })
})

function redriveDependencies(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  return {
    count: vi.fn().mockResolvedValue(0),
    select: vi.fn().mockResolvedValue([]),
    assertQueueJobsAbsent: vi.fn().mockResolvedValue(undefined),
    redrive: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
}
