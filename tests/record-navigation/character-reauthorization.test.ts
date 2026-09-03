import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createCharacterReauthorizationCycle } from '../../app/composables/useCharacterReauthorization'

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('character reauthorization transitions', () => {
  const shell = source('app/pages/characters/[characterId].vue')

  it('prefetches each destination initial data without opening secondary Finance gates', () => {
    const navigation = source('app/composables/useCharacterRecordNavigation.ts')
    expect(navigation).toContain('characterSkillsQuery({')
    expect(navigation).toContain('characterAttributesQuery({')
    expect(navigation).toContain('characterSkillQueueQuery({')
    expect(navigation).toContain("'core-character-clones': () =>")
    expect(navigation).toContain('characterClonesQuery({')
    expect(navigation).toContain('characterImplantsQuery({')
    expect(navigation).toContain("'core-character-finance': () =>")
    expect(navigation).toContain('characterFinanceBalanceQuery({')
    expect(navigation).toContain('characterFinanceJournalQuery({')
    expect(navigation).not.toContain('characterFinanceTransactionsQuery')
    expect(navigation).not.toContain('characterFinanceOpenOrdersQuery')
    expect(navigation).not.toContain('characterFinanceContractsQuery')
    expect(navigation).toContain('characterHistoryQuery({')
    expect(navigation).toContain('mailHeadersQuery({')
    expect(navigation).toContain('mailLabelsQuery({')
    expect(navigation).toContain('mailingListsQuery({')
    expect(navigation).not.toContain('mailDetailQuery')
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

  it('refreshes both independent Clones resources after reauthorization', () => {
    const clones = source('app/pages/characters/[characterId]/clones.vue')
    expect(clones).toContain('useCharacterReauthorization(characterId')
    expect(clones).toContain('Promise.all([clonesQuery.refetch(), implantsQuery.refetch()])')
  })

  it('refreshes only Finance resources and details whose gates were opened', () => {
    const finance = source('app/pages/characters/[characterId]/finance.vue')
    const services = source('app/composables/useCharacterFinanceServices.ts')
    const details = source('app/composables/useCharacterFinanceContractDetail.ts')
    expect(finance).toContain('useCharacterReauthorization(characterId, refreshRequestedFinance)')
    expect(services).toContain('const refreshes: Promise<unknown>[] = [balanceQuery.refetch()]')
    for (const gate of [
      'journalRequested',
      'transactionsRequested',
      'openOrdersRequested',
      'orderHistoryRequested',
      'contractsRequested',
    ]) {
      expect(services).toContain(`if (${gate}.value)`)
    }
    expect(details).toContain('for (const { contractId, contractPage } of openedItemDetails.value)')
    expect(details).toContain('for (const { contractId, contractPage } of openedBidDetails.value)')
  })

  it('opens the order-history request gate only when history mode is selected', () => {
    const services = source('app/composables/useCharacterFinanceServices.ts')
    const serviceActivation = services.slice(
      services.indexOf('function activateService'),
      services.indexOf('function activateOrderMode'),
    )
    const modeActivation = services.slice(
      services.indexOf('function activateOrderMode'),
      services.indexOf('function changePage'),
    )

    expect(serviceActivation).toContain(
      "if (service === 'orders') openOrdersRequested.value = true",
    )
    expect(serviceActivation).not.toContain('orderHistoryRequested.value = true')
    expect(modeActivation).toContain("if (mode === 'history') orderHistoryRequested.value = true")
  })
})
