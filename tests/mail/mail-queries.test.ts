import { PiniaColada, useQuery } from '@pinia/colada'
import { flushPromises } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { createPinia } from 'pinia'
import { createSSRApp, defineComponent, h, nextTick, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it, vi } from 'vitest'
import {
  mailDetailQuery,
  mailDeleteMutation,
  mailHeadersQuery,
  mailingListsQuery,
  mailLabelsQuery,
  mailReadMutation,
  calculateMailCspaMutation,
  resolveMailRecipientsQuery,
  searchMailRecipientsQuery,
  sendMailMutation,
} from '../../app/queries/mail'
import { canRunProtectedQuery } from '../../app/queries/query-cache'
import { PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'
import { QUERY_POLICY } from '../../app/queries/query-policy'
import { createApiClient } from '../../app/utils/api-client'
import { coladaOptions } from '../../app/utils/colada-options'
import { ApiQueryError } from '../../app/utils/query-error'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'

const apiClient = createApiClient('http://localhost')
const characterId = 7
const mailId = 7001
const metadata = {
  cachedUntil: '2026-08-28T12:00:30.000Z',
  source: 'esi',
  stale: false,
  quota: {},
}
const headersResponse = {
  characterId,
  messages: [],
  nextLastMailId: null,
  ...metadata,
}
const detailResponse = {
  characterId,
  mailId,
  sender: null,
  recipients: [],
  subject: 'Message subject',
  sentAt: '2026-08-28T12:00:00.000Z',
  labelIds: [3],
  isRead: false,
  body: 'Message body',
  ...metadata,
}
const labelsResponse = {
  characterId,
  labels: [{ labelId: 3, name: 'Inbox', color: '#ffffff', unreadCount: 1 }],
  totalUnreadCount: 1,
  ...metadata,
}
const listsResponse = {
  characterId,
  mailingLists: [{ mailingListId: 77, name: 'Alliance Logistics' }],
  ...metadata,
}

describe('mail queries', () => {
  it('isolates header cache entries by character, label selection, and pagination cursor', () => {
    expect(PRIVATE_QUERY_KEYS.mailHeaders(7, [9, 3], 800)).toEqual([
      'private',
      'characters',
      7,
      'mail',
      'headers',
      [3, 9],
      800,
    ])
    expect(PRIVATE_QUERY_KEYS.mailHeaders(7, [9, 3], 800)).toEqual(
      PRIVATE_QUERY_KEYS.mailHeaders(7, [3, 9, 3], 800),
    )
    expect(PRIVATE_QUERY_KEYS.mailHeaders(7, [3], null)).not.toEqual(
      PRIVATE_QUERY_KEYS.mailHeaders(7, [9], null),
    )
    expect(PRIVATE_QUERY_KEYS.mailHeaders(7, [3], null)).not.toEqual(
      PRIVATE_QUERY_KEYS.mailHeaders(7, [3], 800),
    )
    expect(PRIVATE_QUERY_KEYS.mailHeaders(7, [3], null)).not.toEqual(
      PRIVATE_QUERY_KEYS.mailHeaders(8, [3], null),
    )
  })

  it('uses the exact published mail freshness windows', () => {
    expect(QUERY_POLICY.mailHeaders.staleTime).toBe(30_000)
    expect(QUERY_POLICY.mailDetail.staleTime).toBe(30_000)
    expect(QUERY_POLICY.mailLabels.staleTime).toBe(30_000)
    expect(QUERY_POLICY.mailingLists.staleTime).toBe(120_000)
  })

  it('reuses fresh mail headers without issuing an early request', async () => {
    const requests = vi.fn()
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/mail', () => {
        requests()
        return HttpResponse.json(headersResponse)
      }),
    )
    const visible = ref(true)
    const Consumer = defineComponent({
      setup() {
        const result = useQuery(mailHeadersQuery({ apiClient, characterId }))
        return () => h('span', result.data.value ? 'loaded' : 'loading')
      },
    })
    const Root = defineComponent({
      setup: () => () => (visible.value ? h(Consumer) : h('span', 'hidden')),
    })
    const { wrapper } = mountWithQueryPlugins(Root)
    await flushPromises()
    expect(requests).toHaveBeenCalledTimes(1)

    visible.value = false
    await nextTick()
    visible.value = true
    await nextTick()
    await flushPromises()

    expect(wrapper.text()).toBe('loaded')
    expect(requests).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('loads all four inferred DTOs and sends normalized header parameters', async () => {
    let requestedLabels: string[] = []
    let requestedCursor: string | null = null
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/mail', ({ request }) => {
        const url = new URL(request.url)
        requestedLabels = url.searchParams.getAll('labels')
        requestedCursor = url.searchParams.get('lastMailId')
        return HttpResponse.json(headersResponse)
      }),
      http.get('http://localhost/api/me/characters/7/mail/7001', () =>
        HttpResponse.json(detailResponse),
      ),
      http.get('http://localhost/api/me/characters/7/mail/labels', () =>
        HttpResponse.json(labelsResponse),
      ),
      http.get('http://localhost/api/me/characters/7/mail/lists', () =>
        HttpResponse.json(listsResponse),
      ),
    )

    const results = await Promise.all([
      runQuery(mailHeadersQuery({ apiClient, characterId, labels: [9, 3, 9], lastMailId: 800 })),
      runQuery(mailDetailQuery({ apiClient, characterId, mailId })),
      runQuery(mailLabelsQuery({ apiClient, characterId })),
      runQuery(mailingListsQuery({ apiClient, characterId })),
    ])

    expect(requestedLabels).toEqual(['3', '9'])
    expect(requestedCursor).toBe('800')
    expect(results).toEqual([headersResponse, detailResponse, labelsResponse, listsResponse])
  })

  it('sends read state alone and does not request labels as a result', async () => {
    let requestBody: unknown
    const labelRequests = vi.fn()
    queryServer.use(
      http.put('http://localhost/api/me/characters/7/mail/7001', async ({ request }) => {
        requestBody = await request.json()
        return new HttpResponse(null, { status: 204 })
      }),
      http.get('http://localhost/api/me/characters/7/mail/labels', labelRequests),
    )

    await mailReadMutation({ apiClient, characterId, mailId, read: true })

    expect(requestBody).toEqual({ read: true })
    expect(requestBody).not.toHaveProperty('labels')
    expect(labelRequests).not.toHaveBeenCalled()
  })

  it('treats an application-level no-content delete as success', async () => {
    const requests = vi.fn()
    queryServer.use(
      http.delete('http://localhost/api/me/characters/7/mail/7001', () => {
        requests()
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await expect(mailDeleteMutation({ apiClient, characterId, mailId })).resolves.toBeUndefined()
    expect(requests).toHaveBeenCalledOnce()
  })

  it('sends mail once, returns the new mail ID, and forwards the approved cost', async () => {
    const requests = vi.fn()
    let requestBody: unknown
    queryServer.use(
      http.post('http://localhost/api/me/characters/7/mail', async ({ request }) => {
        requests()
        requestBody = await request.json()
        return HttpResponse.json({ characterId, mailId: 9001 }, { status: 201 })
      }),
    )

    await expect(
      sendMailMutation({
        apiClient,
        approvedCost: 25,
        body: 'Message body',
        characterId,
        recipients: [{ id: 91, type: 'corporation' }],
        subject: 'Message subject',
      }),
    ).resolves.toBe(9001)
    expect(requests).toHaveBeenCalledOnce()
    expect(requestBody).toEqual({
      approvedCost: 25,
      body: 'Message body',
      recipients: [{ id: 91, type: 'corporation' }],
      subject: 'Message subject',
    })
  })

  it.each([
    [422, 'MAIL_REJECTED'],
    [502, 'MAIL_DELIVERY_UNKNOWN'],
    [403, 'EVE_SCOPE_REQUIRED'],
    [403, 'EVE_REAUTH_REQUIRED'],
  ])('preserves send outcome %s/%s without retrying', async (status, code) => {
    const requests = vi.fn()
    queryServer.use(
      http.post('http://localhost/api/me/characters/7/mail', () => {
        requests()
        return HttpResponse.json(
          {
            authorizeUrl: code.startsWith('EVE_')
              ? 'http://localhost/auth/eve/reauthorize/7'
              : undefined,
            code,
            message: `Outcome ${code}`,
          },
          { status },
        )
      }),
    )

    await expect(
      sendMailMutation({
        apiClient,
        approvedCost: 0,
        body: 'Body',
        characterId,
        recipients: [{ id: 91, type: 'corporation' }],
        subject: 'Subject',
      }),
    ).rejects.toMatchObject({ code, status })
    expect(requests).toHaveBeenCalledOnce()
  })

  it('resolves exact names and searches recipients with isolated private keys', async () => {
    const resolved = [{ id: 91, name: 'Operations Control', type: 'corporation' as const }]
    queryServer.use(
      http.post('http://localhost/api/me/characters/7/mail/recipients/resolve', () =>
        HttpResponse.json({ recipients: resolved }),
      ),
      http.get('http://localhost/api/me/characters/7/mail/recipients/search', ({ request }) => {
        expect(new URL(request.url).searchParams.get('search')).toBe('Operations')
        return HttpResponse.json({ characterId, recipients: resolved, ...metadata })
      }),
    )

    await expect(
      runQuery(
        resolveMailRecipientsQuery({
          apiClient,
          characterId,
          names: [' Operations Control '],
        }),
      ),
    ).resolves.toEqual({ recipients: resolved })
    await expect(
      runQuery(searchMailRecipientsQuery({ apiClient, characterId, query: ' Operations ' })),
    ).resolves.toMatchObject({ characterId, recipients: resolved })
    expect(PRIVATE_QUERY_KEYS.mailRecipientResolution(7, 'operations control')).not.toEqual(
      PRIVATE_QUERY_KEYS.mailRecipientResolution(8, 'operations control'),
    )
  })

  it('returns the CSPA cost for character recipients', async () => {
    let requestBody: unknown
    queryServer.use(
      http.post('http://localhost/api/me/characters/7/mail/cspa', async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({ characterId, cost: 125 })
      }),
    )

    await expect(
      calculateMailCspaMutation({ apiClient, characterId, recipientIds: [44, 44, 45] }),
    ).resolves.toBe(125)
    expect(requestBody).toEqual({ characterIds: [44, 45] })
  })

  it.each([
    [
      403,
      {
        code: 'EVE_SCOPE_REQUIRED',
        message: 'Authorize mail organization.',
        requiredScope: 'esi-mail.organize_mail.v1',
        authorizeUrl: 'http://localhost/auth/eve/reauthorize/7',
      },
    ],
    [
      403,
      {
        code: 'EVE_REAUTH_REQUIRED',
        message: 'Mail organization authorization expired.',
        requiredScope: 'esi-mail.organize_mail.v1',
        authorizeUrl: 'http://localhost/auth/eve/reauthorize/7',
      },
    ],
    [409, { code: 'MAIL_MUTATION_REJECTED', message: 'EVE rejected the mail change.' }],
  ])('preserves mutation error details for status %i', async (status, body) => {
    queryServer.use(
      http.put('http://localhost/api/me/characters/7/mail/7001', () =>
        HttpResponse.json(body, { status }),
      ),
    )

    const error = await mailReadMutation({ apiClient, characterId, mailId, read: true }).catch(
      (mutationError: unknown) => mutationError,
    )

    expect(error).toBeInstanceOf(ApiQueryError)
    expect(error).toMatchObject({ status, ...body })
  })

  it('requests a low-traffic label at the source instead of filtering the general page', async () => {
    const oldLabeledMessage = {
      isRead: true,
      labelIds: [99],
      mailId: 42,
      recipients: [],
      sender: { id: 12, type: 'character', name: 'Archive Keeper' },
      sentAt: '2020-01-01T00:00:00.000Z',
      subject: 'Old but labeled',
    }
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/mail', ({ request }) => {
        const requestedLabels = new URL(request.url).searchParams.getAll('labels')
        return HttpResponse.json({
          ...headersResponse,
          messages: requestedLabels.includes('99') ? [oldLabeledMessage] : [],
        })
      }),
    )

    const result = await runQuery(mailHeadersQuery({ apiClient, characterId, labels: [99] }))

    expect(result.messages).toEqual([oldLabeledMessage])
  })

  it('forwards the query AbortSignal to the mail request', async () => {
    let notifyStarted!: () => void
    let notifyAborted!: () => void
    const started = new Promise<void>((resolve) => (notifyStarted = resolve))
    const aborted = new Promise<void>((resolve) => (notifyAborted = resolve))
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/mail', async ({ request }) => {
        notifyStarted()
        await new Promise<void>((resolve) => {
          request.signal.addEventListener(
            'abort',
            () => {
              notifyAborted()
              resolve()
            },
            { once: true },
          )
        })
        return HttpResponse.json(headersResponse)
      }),
    )
    const controller = new AbortController()
    let requestError: unknown
    const request = runQuery(mailHeadersQuery({ apiClient, characterId }), controller.signal).catch(
      (error: unknown) => {
        requestError = error
      },
    )

    await started
    controller.abort()

    await aborted
    await request
    expect(requestError).toBeDefined()
  })

  it.each([
    [
      'headers character',
      () => mailHeadersQuery({ apiClient, characterId }),
      'http://localhost/api/me/characters/7/mail',
      { ...headersResponse, characterId: 8 },
    ],
    [
      'detail character',
      () => mailDetailQuery({ apiClient, characterId, mailId }),
      'http://localhost/api/me/characters/7/mail/7001',
      { ...detailResponse, characterId: 8 },
    ],
    [
      'detail mail',
      () => mailDetailQuery({ apiClient, characterId, mailId }),
      'http://localhost/api/me/characters/7/mail/7001',
      { ...detailResponse, mailId: 7002 },
    ],
    [
      'labels character',
      () => mailLabelsQuery({ apiClient, characterId }),
      'http://localhost/api/me/characters/7/mail/labels',
      { ...labelsResponse, characterId: 8 },
    ],
    [
      'mailing lists character',
      () => mailingListsQuery({ apiClient, characterId }),
      'http://localhost/api/me/characters/7/mail/lists',
      { ...listsResponse, characterId: 8 },
    ],
  ])('rejects a mismatched %s response with a stable error', async (_name, query, url, body) => {
    queryServer.use(http.get(url, () => HttpResponse.json(body)))

    await expect(runQuery(query())).rejects.toMatchObject({
      status: 409,
      code: 'MAIL_IDENTITY_MISMATCH',
      message: 'Mail response did not match the requested identity.',
    })
  })

  it.each([
    [
      403,
      {
        code: 'EVE_SCOPE_REQUIRED',
        message: 'Authorize mail access.',
        requiredScope: 'esi-mail.read_mail.v1',
        authorizeUrl: 'http://localhost/auth/eve/reauthorize/7',
      },
    ],
    [
      403,
      {
        code: 'EVE_REAUTH_REQUIRED',
        message: 'EVE authorization is no longer valid.',
        requiredScope: 'esi-mail.read_mail.v1',
        authorizeUrl: 'http://localhost/auth/eve/reauthorize/7',
      },
    ],
    [
      429,
      {
        code: 'ESI_COOLDOWN',
        message: 'EVE Online ESI is temporarily rate limited.',
        retryAfterSeconds: 45,
      },
    ],
    [404, { code: 'MAIL_NOT_FOUND', message: 'Mail not found.' }],
  ])('preserves the mail API error envelope for status %i', async (status, body) => {
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/mail/7001', () =>
        HttpResponse.json(body, { status }),
      ),
    )

    const error = await runQuery(mailDetailQuery({ apiClient, characterId, mailId })).catch(
      (queryError: unknown) => queryError,
    )

    expect(error).toBeInstanceOf(ApiQueryError)
    expect(error).toMatchObject({ status, ...body })
  })

  it('keeps all mail factories caller-gated and disabled during SSR', async () => {
    const requests = vi.fn()
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/mail', requests),
      http.get('http://localhost/api/me/characters/7/mail/7001', requests),
      http.get('http://localhost/api/me/characters/7/mail/labels', requests),
      http.get('http://localhost/api/me/characters/7/mail/lists', requests),
    )
    const options = [
      mailHeadersQuery({ apiClient, characterId }),
      mailDetailQuery({ apiClient, characterId, mailId }),
      mailLabelsQuery({ apiClient, characterId }),
      mailingListsQuery({ apiClient, characterId }),
      resolveMailRecipientsQuery({ apiClient, characterId, names: ['Pilot'] }),
      searchMailRecipientsQuery({ apiClient, characterId, query: 'Pilot' }),
    ]
    for (const option of options) expect(option).not.toHaveProperty('enabled')

    const Root = defineComponent({
      setup() {
        for (const option of options) {
          useQuery({
            ...option,
            enabled: canRunProtectedQuery(false, true, characterId),
          })
        }
        return () => h('span', 'mail locked')
      },
    })
    const pinia = createPinia()
    const app = createSSRApp(Root)
    app.use(pinia)
    app.use(PiniaColada, coladaOptions)

    await expect(renderToString(app)).resolves.toContain('mail locked')
    expect(requests).not.toHaveBeenCalled()
  })

  it('keeps mail disabled without authentication or a resolved owned character gate', () => {
    expect(canRunProtectedQuery(true, false, characterId)).toBe(false)
    expect(canRunProtectedQuery(true, true)).toBe(false)
    expect(canRunProtectedQuery(true, true, characterId)).toBe(true)
  })
})

function runQuery<T>(
  options: { query: (context: never) => Promise<T> },
  signal = new AbortController().signal,
) {
  return options.query({ signal } as never)
}
