import { mountSuspended } from '@nuxt/test-utils/runtime'
import { useQueryCache } from '@pinia/colada'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import FinanceContractDrawer from '../../app/components/finance/ContractDrawer.vue'
import FinanceServicePanel from '../../app/components/finance/ServicePanel.vue'
import FinancePage from '../../app/pages/characters/[characterId]/finance.vue'
import { provideCharacterReauthorization } from '../../app/composables/useCharacterReauthorization'
import { PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'
import type { FinanceContract, FinanceResourceState } from '../../app/types/finance'
import { queryServer } from '../support/query-server'

interface FinanceScenario {
  journal: 'data' | 'scope'
  openOrders: 'data' | 'error'
  orderHistory: 'data' | 'stale'
  transactionFailure: boolean
}

const mountedWrappers: { unmount: () => void }[] = []
const requests: URL[] = []
const componentCharacterId = 0
let activeCharacterId = 7_001
let scenario: FinanceScenario
let queryCache: ReturnType<typeof useQueryCache>

const FinanceHost = defineComponent({
  setup() {
    provideCharacterReauthorization()
    queryCache = useQueryCache()
    queryCache.setQueryData(PRIVATE_QUERY_KEYS.characterFinanceBalance(componentCharacterId), {
      characterId: componentCharacterId,
      balance: 1_234_567.89,
      ...metadata(),
    })
    return () => h(FinancePage)
  },
})

async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

function metadata(stale = false) {
  return {
    cachedUntil: '2026-09-02T13:00:00.000Z',
    validatedAt: '2026-09-02T12:00:00.000Z',
    stale,
  }
}

function resourceState(overrides: Partial<FinanceResourceState> = {}): FinanceResourceState {
  return {
    authorizationAction: null,
    authorizationRequired: false,
    canRetry: false,
    errorCode: null,
    errorMessage: null,
    loading: false,
    stale: false,
    ...overrides,
  }
}

beforeAll(() => queryServer.listen({ onUnhandledRequest: 'error' }))
afterAll(() => queryServer.close())

beforeEach(() => {
  requests.length = 0
  scenario = {
    journal: 'data',
    openOrders: 'data',
    orderHistory: 'data',
    transactionFailure: false,
  }
  installHandlers()
})

afterEach(async () => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  queryServer.resetHandlers()
  await settle()
  document.body.replaceChildren()
})

describe('character Finance page', () => {
  it('labels complete and current-page summaries and keeps ledger filters local to each tab', async () => {
    const wrapper = await mountFinance(7_101)

    expect(wrapper.get('.character-finance-route').attributes('aria-label')).toBe(
      'Character finance',
    )
    expect(wrapper.text()).toContain('CHARACTER WALLET')
    // Each summary metric appears only once the service behind it has actually loaded.
    expect(wrapper.get('.finance-hero-metrics').text()).toContain('Net change')
    expect(wrapper.get('.finance-hero-metrics').text()).toContain('+150.00 ISK')
    expect(wrapper.get('.finance-hero-metrics').text()).not.toContain('In escrow')
    expect(wrapper.get('.finance-hero-metrics').text()).not.toContain('Awaiting me')

    // The journal is the ledger's default tab, and it is the only service with data up front.
    const inactivePanels = wrapper.findAll('.finance-tab-panel[hidden]')
    expect(inactivePanels).toHaveLength(3)

    await vi.waitFor(() => expect(wrapper.text()).toContain('Mission reward'))
    expect(wrapper.text()).not.toContain('Tritanium')
    expect(wrapper.text()).not.toContain('Courier package')

    for (const section of wrapper.findAll('.finance-service'))
      expect(section.attributes('aria-label')).toBeTruthy()

    await chip(wrapper, 'Income').trigger('click')
    expect(wrapper.findAll('.finance-table--journal tbody tr')).toHaveLength(2)
    await chip(wrapper, 'Contracts').trigger('click')
    expect(wrapper.findAll('.finance-table--journal tbody tr')).toHaveLength(0)
    expect(wrapper.text()).toContain('Journal page empty')
    await chip(wrapper, 'Market').trigger('click')
    expect(wrapper.findAll('.finance-table--journal tbody tr')).toHaveLength(1)

    await openTab(wrapper, 'Transactions')
    await seedOnly('Market transactions')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Tritanium'))
    expect(wrapper.text()).toContain('Jita IV - Moon 4')
    expect(wrapper.findAll('.finance-table--transactions tbody tr')).toHaveLength(2)

    await wrapper.get('.finance-search input').setValue('Unknown')
    expect(wrapper.findAll('.finance-table--transactions tbody tr')).toHaveLength(1)
    await chip(wrapper, 'Buy').trigger('click')
    expect(wrapper.findAll('.finance-table--transactions tbody tr')).toHaveLength(0)
    await chip(wrapper, 'All').trigger('click')
    await wrapper.get('.finance-search input').setValue('')

    const older = footerButton(wrapper, 'OLDER')
    await older.trigger('click')
    queryCache.setQueryData(
      PRIVATE_QUERY_KEYS.characterFinanceTransactions(componentCharacterId, 900),
      { characterId: componentCharacterId, ...transactionPage(900) },
    )
    await vi.waitFor(() => expect(wrapper.text()).toContain('Older unknown item'))
    await footerButton(wrapper, 'NEWER').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Tritanium'))

    await openTab(wrapper, 'Orders')
    await seedOnly('Open orders')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Pyerite'))
    expect(wrapper.get('.finance-hero-metrics').text()).toContain('In escrow')
    expect(wrapper.get('.finance-hero-metrics').text()).toContain('12,500')
    expect(wrapper.get('.finance-hero-metrics').text()).not.toContain('Awaiting me')
    expect(wrapper.get('.finance-table-footer').text()).toContain('in the complete collection')
    await wrapper.get('[aria-label="Order collection"]').findAll('button')[1]!.trigger('click')
    await seedOnly('Order history')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Scordite'))
    expect(wrapper.get('.finance-table--orders .finance-volume').text()).toBe('0 / 20')
    expect(wrapper.get('.finance-table-footer').text()).toContain('on the loaded page')
    expect(wrapper.text()).toContain('EXPIRED')

    await openTab(wrapper, 'Contracts')
    await seedOnly('Contracts')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Courier package'))
    expect(wrapper.get('.finance-hero-metrics').text()).toContain('contracts assigned to you')
    await chip(wrapper, 'Couriers').trigger('click')
    expect(wrapper.findAll('.finance-contract-row')).toHaveLength(1)

    // Returning to a tab preserves the filter it was left with.
    await openTab(wrapper, 'Journal')
    expect(chip(wrapper, 'Market').attributes('data-state')).toBe('on')
    expect(wrapper.findAll('.finance-table--journal tbody tr')).toHaveLength(1)
    await openTab(wrapper, 'Contracts')
    expect(chip(wrapper, 'Couriers').attributes('data-state')).toBe('on')
  })

  it('scopes the ledger range to loaded data without refetching a service', async () => {
    const wrapper = await mountFinance(7_105)
    await vi.waitFor(() => expect(wrapper.text()).toContain('Mission reward'))

    const before = financeRequests().length
    expect(wrapper.findAll('.finance-table--journal tbody tr')).toHaveLength(2)

    await rangeButton(wrapper, '7D').trigger('click')
    expect(wrapper.findAll('.finance-table--journal tbody tr')).toHaveLength(2)
    expect(financeRequests()).toHaveLength(before)

    await rangeButton(wrapper, 'ALL').trigger('click')
    expect(wrapper.findAll('.finance-table--journal tbody tr')).toHaveLength(2)
    expect(financeRequests()).toHaveLength(before)
    expect(wrapper.get('.finance-table-footer').text()).toContain('on the loaded page')
  })

  it('wires accessible ledger tabs with roving keyboard navigation', async () => {
    const wrapper = await mountFinance(7_106)
    const tabs = wrapper.findAll('.finance-tabs .ui-tabs-trigger')
    const journalTab = tabs[0]!
    const transactionsTab = tabs[1]!
    const contractsTab = tabs[3]!

    expect(journalTab.attributes('role')).toBe('tab')
    expect(journalTab.attributes('data-state')).toBe('active')
    expect(transactionsTab.attributes('data-state')).toBe('inactive')
    expect(journalTab.attributes('aria-controls')).toBeTruthy()
    expect(wrapper.get('.finance-tab-panel').attributes('aria-labelledby')).toBe(
      journalTab.attributes('id'),
    )

    journalTab.element.focus()
    await journalTab.trigger('keydown', { key: 'ArrowRight' })
    await settle()
    expect(transactionsTab.attributes('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(transactionsTab.element)

    await transactionsTab.trigger('keydown', { key: 'End' })
    await settle()
    expect(contractsTab.attributes('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(contractsTab.element)

    await contractsTab.trigger('keydown', { key: 'Home' })
    await settle()
    expect(journalTab.attributes('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(journalTab.element)
  })

  it('preserves successful siblings through independent loading, scope, error, stale, and refresh states', async () => {
    const refreshing = ref(false)
    const refreshError = ref<Error | null>(null)
    const StateHost = defineComponent({
      setup() {
        const startRefresh = () => {
          refreshing.value = true
          void nextTick(() => {
            refreshError.value = new Error('Filtered service refresh failed.')
            refreshing.value = false
          })
        }
        return () =>
          h('div', [
            h('button', { 'data-refresh': '', onClick: startRefresh }, 'REFRESH SIBLING'),
            h(FinanceServicePanel, {
              hasData: false,
              state: resourceState({ loading: true }),
              title: 'Loading service',
            }),
            h(FinanceServicePanel, {
              hasData: false,
              state: resourceState({
                authorizationAction: {
                  href: '/reauthorize',
                  label: 'AUTHORIZE THIS CHARACTER',
                },
                authorizationRequired: true,
                errorCode: 'SCOPE REQUIRED',
                errorMessage: 'Authorize this service.',
              }),
              title: 'Scope service',
            }),
            h(FinanceServicePanel, {
              hasData: false,
              state: resourceState({
                canRetry: true,
                errorCode: 'ESI 502 / FINANCE',
                errorMessage: 'Service failed independently.',
              }),
              title: 'Failed service',
            }),
            h(
              FinanceServicePanel,
              {
                hasData: true,
                state: resourceState({
                  canRetry: refreshError.value !== null,
                  errorCode: refreshError.value ? 'ESI 502 / FINANCE' : null,
                  errorMessage: refreshError.value?.message ?? null,
                  loading: refreshing.value,
                  stale: true,
                }),
                title: 'Successful service',
                validatedAt: '2026-09-02T12:00:00.000Z',
                onRetry: startRefresh,
              },
              { default: () => h('p', { 'data-sibling-data': '' }, 'Preserved sibling data') },
            ),
          ])
      },
    })
    const wrapper = await mountSuspended(StateHost, { attachTo: document.body, route: false })
    mountedWrappers.push(wrapper)

    const panels = wrapper.findAll('.finance-service')
    expect(panels[0]?.attributes('aria-busy')).toBe('true')
    expect(panels[0]?.find('[role="status"]').exists()).toBe(true)
    expect(panels[1]?.text()).toContain('Scope service not authorized')
    expect(panels[1]?.get('a').attributes('href')).toBe('/reauthorize')
    expect(panels[2]?.get('[role="alert"]').text()).toContain('Service failed independently.')
    expect(panels[3]?.get('output.finance-stale-notice').text()).toContain(
      'Validated 02 Sept, 12:00 UTC.',
    )
    expect(panels[3]?.text()).toContain('Preserved sibling data')

    await wrapper.get('[data-refresh]').trigger('click')
    expect(panels[3]?.text()).toContain('Preserved sibling data')
    await vi.waitFor(() =>
      expect(panels[3]?.get('[role="alert"]').text()).toContain('Filtered service refresh failed.'),
    )
    expect(panels[0]?.find('[role="status"]').exists()).toBe(true)
    expect(panels[1]?.text()).toContain('Authorize this service.')
    expect(panels[2]?.text()).toContain('Service failed independently.')
    expect(panels[3]?.text()).toContain('Preserved sibling data')
  })

  it('keeps authorization failures without a URL actionable in contract details', async () => {
    const drawerContract: FinanceContract = {
      availability: 'personal',
      collateral: null,
      contractId: 7_001,
      daysToComplete: null,
      expiredAt: '2026-09-08T10:00:00.000Z',
      issuedAt: '2026-09-01T10:00:00.000Z',
      price: 100,
      reward: null,
      role: 'assigned',
      status: 'outstanding',
      title: 'Item exchange',
      type: 'item_exchange',
      volume: 5,
    }
    const wrapper = await mountSuspended(FinanceContractDrawer, {
      attachTo: document.body,
      props: {
        bidPrivacyNote: '',
        bidState: resourceState(),
        bids: null,
        contract: drawerContract,
        description: 'Contract details',
        itemState: resourceState({
          authorizationRequired: true,
          errorCode: 'ESI 403 / FINANCE',
          errorMessage: 'Contract item authorization is unavailable.',
        }),
        items: null,
        now: Date.parse('2026-09-02T12:00:00.000Z'),
        open: true,
      },
      route: false,
    })
    mountedWrappers.push(wrapper)
    await settle()

    const retry = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === 'RETRY',
    )
    expect(retry).toBeDefined()
    retry!.click()
    await settle()
    expect(wrapper.emitted('retry-items')).toHaveLength(1)
  })

  it('keeps contract drill-downs applicable and restores focus on close and page-local navigation', async () => {
    const wrapper = await mountFinance(7_103)
    await openTab(wrapper, 'Contracts')
    await seedOnly('Contracts')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Loan terms'))

    const auctionTrigger = contractButton(wrapper, 'Auction lot')
    auctionTrigger.element.focus()
    await auctionTrigger.trigger('click')
    await settle()
    const drawer = document.querySelector<HTMLElement>('.finance-drawer[data-state="open"]')!
    const closeButton = drawer.querySelector<HTMLButtonElement>('.ui-drawer-close')!
    expect(drawer.getAttribute('role')).toBe('dialog')
    expect(drawer.getAttribute('aria-modal')).toBe('true')
    expect(drawer.dataset.side).toBe('right')
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.activeElement).toBe(closeButton)
    expect(drawer.textContent).toContain('Items')
    expect(drawer.textContent).toContain('Bids')

    const lastButton = drawer.querySelector<HTMLButtonElement>('.finance-drawer-actions button')!
    lastButton.focus()
    lastButton.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }))
    await settle()
    expect(document.activeElement).toBe(closeButton)

    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    await settle()
    expect(document.querySelector('.finance-drawer[data-state="open"]')).toBeNull()
    expect(document.activeElement).toBe(auctionTrigger.element)

    await contractButton(wrapper, 'Courier package').trigger('click')
    await settle()
    expect(document.querySelector('.finance-drawer[data-state="open"]')?.textContent).toContain(
      'Items',
    )
    expect(document.querySelector('.finance-drawer[data-state="open"]')?.textContent).not.toContain(
      'Bids',
    )

    // A loan carries neither an item manifest nor bids, so opening it costs no drill-down request.
    const beforeLoan = contractDetailRequests().length
    await contractButton(wrapper, 'Loan terms').trigger('click')
    await settle()
    expect(contractDetailRequests()).toHaveLength(beforeLoan)
    expect(document.querySelector('.finance-drawer[data-state="open"]')?.textContent).not.toContain(
      'Bids',
    )
    expect(document.querySelector('.finance-drawer[data-state="open"]')?.textContent).not.toContain(
      'Items',
    )

    await footerButton(wrapper, 'NEXT').trigger('click')
    queryCache.setQueryData(
      PRIVATE_QUERY_KEYS.characterFinanceContractPage(componentCharacterId, 2),
      {
        characterId: componentCharacterId,
        contracts: [],
        page: 2,
        totalPages: 2,
        ...metadata(),
      },
    )
    await vi.waitFor(() => expect(wrapper.text()).toContain('Contract page empty'))
    expect(document.querySelector('.finance-drawer[data-state="open"]')).toBeNull()
  })

  it('requests only activated public item details without refetching Finance collections', async () => {
    const wrapper = await mountFinance(7_104)
    await openTab(wrapper, 'Transactions')
    await seedOnly('Market transactions')
    await openTab(wrapper, 'Orders')
    await seedOnly('Open orders')
    await seedOnly('Order history')
    await openTab(wrapper, 'Contracts')
    await seedOnly('Contracts')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Auction lot'))

    await contractButton(wrapper, 'Auction lot').trigger('click')
    await settle()
    queryCache.setQueryData(
      PRIVATE_QUERY_KEYS.characterFinanceContractItems(componentCharacterId, 7_001),
      {
        characterId: componentCharacterId,
        contractId: 7_001,
        items: [
          {
            recordId: 301,
            typeId: 37,
            typeName: 'Mexallon',
            direction: 'included',
            quantity: 1,
            isSingleton: true,
            blueprint: 'copy',
          },
        ],
        ...metadata(),
      },
    )
    await vi.waitFor(() => expect(document.body.textContent).toContain('Mexallon'))
    expect(document.querySelector('.finance-drawer[data-state="open"]')?.textContent).toContain(
      'BLUEPRINT COPY',
    )

    const triggers = [itemTrigger('Mexallon')]
    for (const trigger of triggers) {
      trigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
      trigger.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
    }
    await settle()
    expect(typeDetailRequests()).toEqual([])

    const financeBeforePopovers = financeRequests().map((url) => url.href)
    for (const trigger of triggers) {
      trigger.focus()
      trigger.click()
      await vi.waitFor(() =>
        expect(
          document.querySelector('.eve-item-information-popover[role="dialog"] h2')?.textContent,
        ).toBe('Mexallon'),
      )
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
      await settle()
      expect(document.querySelector('.eve-item-information-popover[role="dialog"]')).toBeNull()
      expect(document.activeElement).toBe(trigger)
    }

    expect(typeDetailRequests().map((url) => url.pathname)).toEqual(['/api/universe/types/37'])
    expect(financeRequests().map((url) => url.href)).toEqual(financeBeforePopovers)
  })
})

async function mountFinance(characterId: number) {
  activeCharacterId = characterId
  const wrapper = await mountSuspended(FinanceHost, {
    attachTo: document.body,
    route: `/characters/${characterId}/finance`,
  })
  mountedWrappers.push(wrapper)
  await vi.waitFor(() => expect(wrapper.text()).toContain('1,234,567.89 ISK'))
  seedService('Wallet journal')
  await settle()
  return wrapper
}

async function openTab(wrapper: Awaited<ReturnType<typeof mountFinance>>, label: string) {
  const tab = wrapper
    .findAll('.finance-tabs .ui-tabs-trigger')
    .find((candidate) => candidate.text().startsWith(label))
  expect(tab, `${label} tab was not rendered`).toBeDefined()
  await tab!.trigger('mousedown', { button: 0, ctrlKey: false })
  await settle()
}

// Activating a tab requests its resource, so a test only has to supply the response.
async function seedOnly(service: string) {
  seedService(service)
  await settle()
}

function chip(wrapper: Awaited<ReturnType<typeof mountFinance>>, label: string) {
  const found = wrapper
    .findAll('.finance-toolbar .ui-toggle-group-item')
    .find((candidate) => candidate.text().trim() === label)
  expect(found, `${label} chip was not rendered`).toBeDefined()
  return found!
}

function rangeButton(wrapper: Awaited<ReturnType<typeof mountFinance>>, label: string) {
  const found = wrapper
    .get('[aria-label="Loaded data range"]')
    .findAll('button')
    .find((candidate) => candidate.text().trim() === label)
  expect(found, `${label} range was not rendered`).toBeDefined()
  return found!
}

function footerButton(wrapper: Awaited<ReturnType<typeof mountFinance>>, label: string) {
  const found = wrapper
    .findAll('.finance-footer-actions button')
    .find((candidate) => candidate.text().trim() === label)
  expect(found, `${label} footer control was not rendered`).toBeDefined()
  return found!
}

function seedService(title: string) {
  if (title === 'Wallet journal') {
    queryCache.setQueryData(PRIVATE_QUERY_KEYS.characterFinanceJournal(componentCharacterId, 1), {
      characterId: componentCharacterId,
      entries: journalEntries(),
      page: 1,
      totalPages: 3,
      ...metadata(),
    })
  }
  if (title === 'Market transactions') {
    queryCache.setQueryData(
      PRIVATE_QUERY_KEYS.characterFinanceTransactions(componentCharacterId, null),
      { characterId: componentCharacterId, ...transactionPage(null) },
    )
  }
  if (title === 'Open orders') {
    queryCache.setQueryData(PRIVATE_QUERY_KEYS.characterFinanceOpenOrders(componentCharacterId), {
      characterId: componentCharacterId,
      orders: openOrders(),
      ...metadata(),
    })
  }
  if (title === 'Order history') {
    queryCache.setQueryData(
      PRIVATE_QUERY_KEYS.characterFinanceOrderHistory(componentCharacterId, 1),
      {
        characterId: componentCharacterId,
        orders: historyOrders(),
        page: 1,
        totalPages: 2,
        ...metadata(),
      },
    )
  }
  if (title === 'Contracts') {
    queryCache.setQueryData(
      PRIVATE_QUERY_KEYS.characterFinanceContractPage(componentCharacterId, 1),
      {
        characterId: componentCharacterId,
        contracts: contracts(),
        page: 1,
        totalPages: 2,
        ...metadata(),
      },
    )
  }
}

function contractButton(wrapper: Awaited<ReturnType<typeof mountFinance>>, title: string) {
  const row = wrapper
    .findAll('.finance-contract-row')
    .find((candidate) => candidate.text().includes(title))
  expect(row, `${title} contract was not rendered`).toBeDefined()
  return row!.get('button')
}

function itemTrigger(name: string) {
  const trigger = document.querySelector<HTMLButtonElement>(
    `button[aria-label="View item information for ${name}"]`,
  )
  expect(trigger, `${name} item trigger was not rendered`).not.toBeNull()
  expect(trigger!.tagName).toBe('BUTTON')
  return trigger!
}

function financeRequests() {
  return requests.filter((url) =>
    url.pathname.startsWith(`/api/me/characters/${activeCharacterId}/`),
  )
}

function contractDetailRequests() {
  return financeRequests().filter((url) => /\/contracts\/\d+\/(items|bids)$/.test(url.pathname))
}

function typeDetailRequests() {
  return requests.filter((url) => url.pathname.startsWith('/api/universe/types/'))
}

function installHandlers() {
  queryServer.use(
    http.get('*/auth/config', () =>
      HttpResponse.json({
        configured: true,
        loginUrl: '/auth/eve/login',
        attachUrl: '/auth/eve/attach',
      }),
    ),
    http.get('*/auth/session', () =>
      HttpResponse.json({
        authenticated: true,
        account: {
          userId: 'finance-component-user',
          mainCharacter: { characterId: activeCharacterId, name: 'Finance Pilot' },
        },
      }),
    ),
    http.get('*/api/me/characters', () =>
      HttpResponse.json({ characters: [ownedCharacter(activeCharacterId)] }),
    ),
    http.get('*/api/me/characters/:characterId/wallet', ({ request, params }) => {
      requests.push(new URL(request.url))
      return HttpResponse.json({
        characterId: Number(params.characterId),
        balance: 1_234_567.89,
        ...metadata(),
      })
    }),
    http.get('*/api/me/characters/:characterId/wallet/journal', ({ request, params }) => {
      requests.push(new URL(request.url))
      if (scenario.journal === 'scope') {
        return HttpResponse.json(
          {
            code: 'EVE_SCOPE_REQUIRED',
            message: 'Authorize wallet journal access.',
            requiredScope: 'esi-wallet.read_character_wallet.v1',
            authorizeUrl: `/auth/eve/reauthorize/${params.characterId}`,
          },
          { status: 403 },
        )
      }
      const page = Number(new URL(request.url).searchParams.get('page'))
      return HttpResponse.json({
        characterId: Number(params.characterId),
        entries: page === 1 ? journalEntries() : [],
        page,
        totalPages: 3,
        ...metadata(),
      })
    }),
    http.get('*/api/me/characters/:characterId/wallet/transactions', ({ request, params }) => {
      requests.push(new URL(request.url))
      if (scenario.transactionFailure) {
        return HttpResponse.json(
          { code: 'ESI_UNAVAILABLE', message: 'Transaction refresh failed.' },
          { status: 502 },
        )
      }
      const fromId = new URL(request.url).searchParams.get('fromId')
      return HttpResponse.json({
        characterId: Number(params.characterId),
        ...transactionPage(fromId === null ? null : Number(fromId)),
      })
    }),
    http.get('*/api/me/characters/:characterId/market/orders', ({ request, params }) => {
      requests.push(new URL(request.url))
      if (scenario.openOrders === 'error') {
        return HttpResponse.json(
          { code: 'ESI_UNAVAILABLE', message: 'Open orders failed independently.' },
          { status: 502 },
        )
      }
      return HttpResponse.json({
        characterId: Number(params.characterId),
        orders: openOrders(),
        ...metadata(),
      })
    }),
    http.get('*/api/me/characters/:characterId/market/orders/history', ({ request, params }) => {
      requests.push(new URL(request.url))
      const page = Number(new URL(request.url).searchParams.get('page'))
      return HttpResponse.json({
        characterId: Number(params.characterId),
        orders: page === 1 ? historyOrders() : [],
        page,
        totalPages: 2,
        ...metadata(scenario.orderHistory === 'stale'),
      })
    }),
    http.get('*/api/me/characters/:characterId/contracts', ({ request, params }) => {
      requests.push(new URL(request.url))
      const page = Number(new URL(request.url).searchParams.get('page'))
      return HttpResponse.json({
        characterId: Number(params.characterId),
        contracts: page === 1 ? contracts() : [],
        page,
        totalPages: 2,
        ...metadata(),
      })
    }),
    http.get(
      '*/api/me/characters/:characterId/contracts/:contractId/items',
      ({ request, params }) => {
        requests.push(new URL(request.url))
        return HttpResponse.json({
          characterId: Number(params.characterId),
          contractId: Number(params.contractId),
          items: [
            {
              recordId: 301,
              typeId: 37,
              typeName: 'Mexallon',
              direction: 'included',
              quantity: 1,
              isSingleton: true,
              blueprint: 'copy',
            },
          ],
          ...metadata(),
        })
      },
    ),
    http.get(
      '*/api/me/characters/:characterId/contracts/:contractId/bids',
      ({ request, params }) => {
        requests.push(new URL(request.url))
        return HttpResponse.json({
          characterId: Number(params.characterId),
          contractId: Number(params.contractId),
          bids: [{ bidId: 401, amount: 250, bidAt: '2026-09-02T11:30:00.000Z' }],
          ...metadata(),
        })
      },
    ),
    http.get('*/api/universe/types/:typeId', ({ request, params }) => {
      requests.push(new URL(request.url))
      const typeId = Number(params.typeId)
      if (typeId === 999_999) {
        return HttpResponse.json(
          { code: 'TYPE_NOT_FOUND', message: 'Type not found.' },
          { status: 404 },
        )
      }
      const names = new Map([
        [34, 'Tritanium'],
        [35, 'Pyerite'],
        [36, 'Scordite'],
        [37, 'Mexallon'],
      ])
      return HttpResponse.json({
        typeId,
        name: names.get(typeId),
        description: `Public static detail for type ${typeId}.`,
        group: { id: 18, name: 'Mineral' },
        category: { id: 4, name: 'Material' },
        detail: null,
      })
    }),
  )
}

function transactionPage(fromId: number | null) {
  return {
    transactions:
      fromId === null
        ? [
            transaction(1_002, 34, 'Tritanium', true),
            transaction(1_001, 999_999, 'Unknown type 999999', false),
          ]
        : [transaction(899, 999_999, 'Older unknown item', false)],
    fromId,
    nextFromId: fromId === null ? 900 : null,
    ...metadata(),
  }
}

function transaction(transactionId: number, typeId: number, typeName: string, isBuy: boolean) {
  return {
    transactionId,
    journalRefId: transactionId + 10,
    date: '2026-09-02T11:00:00.000Z',
    typeId,
    typeName,
    quantity: 5,
    unitPrice: 10,
    totalPrice: 50,
    isBuy,
    locationId: 60_000_001,
    locationName: 'Jita IV - Moon 4',
  }
}

function journalEntries() {
  return [
    {
      journalId: 101,
      date: '2026-09-02T11:00:00.000Z',
      amount: 50,
      balance: 1_000,
      referenceType: 'market_transaction',
      description: 'Market purchase',
      reason: null,
      taxAmount: null,
      context: null,
    },
    {
      journalId: 102,
      date: '2026-09-01T11:00:00.000Z',
      amount: 100,
      balance: 950,
      referenceType: 'mission_reward',
      description: 'Mission reward',
      reason: 'Objective complete',
      taxAmount: null,
      context: null,
    },
  ]
}

function openOrders() {
  return [
    { ...marketOrder(201, 35, 'Pyerite', true, 500), escrow: 12_500 },
    marketOrder(202, 34, 'Tritanium', false, 750),
  ]
}

function historyOrders() {
  return [
    {
      ...marketOrder(301, 36, 'Scordite', false, 20),
      volumeRemain: 20,
      state: 'expired',
    },
    { ...marketOrder(302, 35, 'Pyerite', true, 30), state: 'cancelled' },
  ]
}

function marketOrder(
  orderId: number,
  typeId: number,
  typeName: string,
  isBuy: boolean,
  price: number,
) {
  return {
    orderId,
    typeId,
    typeName,
    isBuy,
    price,
    volumeRemain: 10,
    volumeTotal: 20,
    minimumVolume: null,
    escrow: null,
    range: 'station',
    locationId: 60_000_001,
    locationName: 'Jita IV - Moon 4',
    regionId: 10_000_002,
    issuedAt: '2026-09-01T10:00:00.000Z',
    durationDays: 30,
    expiresAt: '2026-10-01T10:00:00.000Z',
  }
}

function contracts() {
  return [
    contract(7_001, 'auction', 'Auction lot'),
    contract(7_002, 'courier', 'Courier package'),
    contract(7_003, 'loan', 'Loan terms'),
  ]
}

function contract(contractId: number, type: string, title: string) {
  return {
    contractId,
    type,
    status: 'outstanding',
    availability: 'personal',
    role: type === 'auction' ? 'assigned' : 'issued',
    title,
    issuedAt: '2026-09-01T10:00:00.000Z',
    expiredAt: '2026-09-08T10:00:00.000Z',
    acceptedAt: null,
    completedAt: null,
    daysToComplete: null,
    startLocationId: 60_000_001,
    endLocationId: null,
    price: 100,
    reward: null,
    collateral: type === 'courier' ? 500 : null,
    buyout: type === 'auction' ? 200 : null,
    volume: 5,
  }
}

function ownedCharacter(characterId: number) {
  return {
    characterId,
    name: 'Finance Pilot',
    corporationId: 98_000_001,
    allianceId: null,
    isMain: true,
    birthday: '2020-01-01T00:00:00.000Z',
    securityStatus: 1.2,
    raceFactionId: 500_001,
    location: { solarSystemId: 30_000_142, solarSystemName: 'Jita' },
    ship: { typeId: 670, typeName: 'Capsule', name: 'Ledger' },
    walletBalance: 1_234_567.89,
    totalSp: 5_000_000,
    corporation: { id: 98_000_001, name: 'Finance Corporation' },
    alliance: null,
  }
}
