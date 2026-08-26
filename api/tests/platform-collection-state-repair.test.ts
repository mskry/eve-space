import { describe, expect, test, vi } from 'vitest'
import { repairPlatformCollectionState } from '../src/platform/collection-state-repair.js'

const resource = {
  moduleId: 'test-feature',
  resourceId: 'wallet-journal',
  subjectKind: 'character',
  operationId: 'wallet-balance',
  materializationIntervalSeconds: 900,
  eligibility: { kind: 'current-owned-character' },
  implementation: () => Promise.resolve({}),
} as const

describe('platform collection-state repair', () => {
  test('converges authorization state from current PostgreSQL state', async () => {
    const calls: { text: string; values: unknown[] }[] = []
    const connection = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join('?'), values })
      return Promise.resolve([])
    })

    await expect(
      repairPlatformCollectionState({
        characterId: 1404328063,
        connection: connection as never,
        resources: [resource, { ...resource, resourceId: 'skills', operationId: 'skills' }],
      }),
    ).resolves.toEqual({ repairedResources: 2 })

    expect(calls).toHaveLength(2)
    expect(calls[0]?.text).toContain("'authorization-required'")
    expect(calls[1]?.text).toContain(
      'state.authorization_generation is distinct from token.token_version',
    )
    for (const call of calls) {
      expect(call.values).toContain('1404328063')
      expect(call.values[0]).toEqual(expect.stringContaining('"module_id":"test-feature"'))
      expect(call.values[0]).toEqual(
        expect.stringContaining('"required_scope":"esi-wallet.read_character_wallet.v1"'),
      )
      expect(call.values[0]).toEqual(
        expect.stringContaining('"required_scope":"esi-skills.read_skills.v1"'),
      )
    }
  })

  test('ignores public resources without authorization generations', async () => {
    const connection = vi.fn()
    const resources = [{ ...resource, operationId: 'public-character' }] as const

    await expect(
      repairPlatformCollectionState({ connection: connection as never, resources }),
    ).resolves.toEqual({ repairedResources: 0 })
    expect(connection).not.toHaveBeenCalled()
  })

  test('stops between set-based transitions when the planner lease is lost', async () => {
    const lease = new AbortController()
    const connection = vi.fn().mockImplementation(() => {
      lease.abort(new Error('lease lost'))
      return Promise.resolve([])
    })

    await expect(
      repairPlatformCollectionState({
        connection: connection as never,
        resources: [resource],
        signal: lease.signal,
      }),
    ).rejects.toThrow('lease lost')
    expect(connection).toHaveBeenCalledOnce()
  })
})
