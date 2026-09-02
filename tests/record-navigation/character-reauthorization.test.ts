import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createCharacterReauthorizationCycle } from '../../app/composables/useCharacterReauthorization'

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('character reauthorization transitions', () => {
  const shell = source('app/pages/characters/[characterId].vue')

  it('prefetches only the Finance balance from character navigation intent', () => {
    const navigation = source('app/composables/useCharacterRecordNavigation.ts')
    expect(navigation).toContain("'core-character-finance': () =>")
    expect(navigation).toContain('characterFinanceBalanceQuery({')
    expect(navigation).not.toContain('characterFinanceJournalQuery')
    expect(navigation).not.toContain('characterFinanceTransactionsQuery')
    expect(navigation).not.toContain('characterFinanceOpenOrdersQuery')
    expect(navigation).not.toContain('characterFinanceContractsQuery')
  })

  it('keys the nested page by route without remounting for the callback parameter', () => {
    expect(shell).toContain('<NuxtPage :key="characterPageKey" />')
    expect(shell).toContain('router.resolve(routeLocationWithoutReauthorization()).fullPath')
    expect(shell).toContain('authLoading && !callbackProcessing')
    expect(shell).toContain('reauthorizeFeedbackStatus.value = callbackStatus')
    expect(shell).toContain('delete query.reauthorize')
    expect(shell).toContain('router.replace(routeLocationWithoutReauthorization())')
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

  it('refreshes only Finance resources and details whose gates were opened', () => {
    const finance = source('app/pages/characters/[characterId]/finance.vue')
    expect(finance).toContain('useCharacterReauthorization(characterId, refreshRequestedFinance)')
    expect(finance).toContain('void balanceQuery.refetch()')
    for (const gate of [
      'journalRequested',
      'transactionsRequested',
      'openOrdersRequested',
      'orderHistoryRequested',
      'contractsRequested',
    ]) {
      expect(finance).toContain(`if (${gate}.value)`)
    }
    expect(finance).toContain('for (const [contractId, openedOnPage] of requestedItemPages.value)')
    expect(finance).toContain('for (const [contractId, openedOnPage] of requestedBidPages.value)')
  })

  it('opens the order-history request gate only when history mode is selected', () => {
    const finance = source('app/pages/characters/[characterId]/finance.vue')
    const tabSelection = finance.slice(
      finance.indexOf('function selectTab'),
      finance.indexOf('function reviewAwaitingContracts'),
    )
    const modeSelection = finance.slice(
      finance.indexOf('function selectOrderMode'),
      finance.indexOf('function changePage'),
    )

    expect(tabSelection).toContain("if (tab === 'orders') openOrdersRequested.value = true")
    expect(tabSelection).not.toContain('orderHistoryRequested.value = true')
    expect(modeSelection).toContain("if (mode === 'history') orderHistoryRequested.value = true")
  })
})
