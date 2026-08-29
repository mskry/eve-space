import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createCharacterReauthorizationCycle } from '../../app/composables/useCharacterReauthorization'

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('character reauthorization transitions', () => {
  const shell = source('app/pages/characters/[characterId].vue')

  it('keeps the nested page mounted and replaces the processed callback URL', () => {
    expect(shell).toContain('<NuxtPage />')
    expect(shell).not.toContain('route.fullPath')
    expect(shell).toContain('authLoading && !callbackProcessing')
    expect(shell).toContain('reauthorizeFeedbackStatus.value = callbackStatus')
    expect(shell).toContain('delete query.reauthorize')
    expect(shell).toContain('router.replace({ path: route.path, query, hash: route.hash })')
  })

  it('refreshes account context once while callback processing is active', () => {
    expect(shell).toContain('callbackProcessing.value')
    expect(shell).toContain('Promise.allSettled([refreshAuthContext(), refetchCharacterRoster()])')
    expect(shell).toContain('reauthorizationCycle.finish()')
  })

  it('allows only one mounted child to consume a callback cycle', () => {
    const cycle = createCharacterReauthorizationCycle()
    cycle.begin('success')

    expect(cycle.consume('success')).toBe(true)
    expect(cycle.consume('success')).toBe(false)

    cycle.finish()
    cycle.begin('success')
    expect(cycle.consume('success')).toBe(true)
  })

  it.each([
    ['app/pages/characters/[characterId]/index.vue', 'overviewQuery.refetch()'],
    ['app/pages/characters/[characterId]/skills.vue', 'skillsQuery.refetch()'],
    ['app/pages/characters/[characterId]/mail.vue', 'retryMailbox'],
  ])('%s keeps its feature-owned success refresh', (path, refresh) => {
    const page = source(path)
    expect(page).toContain('useCharacterReauthorization(characterId')
    expect(page).toContain(refresh)
  })

  it('only refreshes requested wallet transactions', () => {
    const wallet = source('app/pages/characters/[characterId]/wallet.vue')
    expect(wallet).toContain('useCharacterReauthorization(characterId')
    expect(wallet).toContain('walletQueryResult.refetch()')
    expect(wallet).toContain('if (transactionsRequested.value) void transactionQuery.refetch()')
  })
})
