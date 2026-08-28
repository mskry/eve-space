import { http, HttpResponse } from 'msw'
import { defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useMailMutations } from '../../app/composables/useMailMutations'
import {
  mailDetailQuery,
  mailHeadersQuery,
  mailLabelsQuery,
  type MailHeader,
} from '../../app/queries/mail'
import { createApiClient } from '../../app/utils/api-client'
import { ApiQueryError } from '../../app/utils/query-error'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'

const apiClient = createApiClient('http://localhost')
const characterId = 7
const metadata = {
  cachedUntil: '2026-08-28T12:00:30.000Z',
  quota: {},
  source: 'esi' as const,
  stale: false,
}

describe('mail mutations', () => {
  it('applies read state before the request resolves and retains it after success', async () => {
    let finishRequest!: () => void
    const requestCanFinish = new Promise<void>((resolve) => (finishRequest = resolve))
    queryServer.use(
      http.put('http://localhost/api/me/characters/7/mail/1', async () => {
        await requestCanFinish
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { mutations, unmount } = mountMutations()

    const request = mutations.setMailRead({
      characterId,
      header: mailHeader(1, false),
      read: true,
    })
    expect(mutations.readStateOverrides.value.get(1)).toBe(true)
    expect(mutations.readPendingIds.value.has(1)).toBe(true)

    finishRequest()
    await expect(request).resolves.toEqual({ success: true })
    expect(mutations.readStateOverrides.value.get(1)).toBe(true)
    expect(mutations.readPendingIds.value.has(1)).toBe(false)
    unmount()
  })

  it('does not cancel an issued read write when the mailbox component unmounts', async () => {
    let finishRequest!: () => void
    const requestCanFinish = new Promise<void>((resolve) => (finishRequest = resolve))
    const requests = vi.fn()
    queryServer.use(
      http.put('http://localhost/api/me/characters/7/mail/1', async () => {
        requests()
        await requestCanFinish
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { mutations, unmount } = mountMutations()

    const request = mutations.setMailRead({
      characterId,
      header: mailHeader(1, false),
      read: true,
    })
    unmount()
    finishRequest()

    await expect(request).resolves.toEqual({ success: true })
    expect(requests).toHaveBeenCalledOnce()
  })

  it('commits successful read state and counts to every fresh cache entry without refetching', async () => {
    const labelRequests = vi.fn()
    queryServer.use(
      http.put(
        'http://localhost/api/me/characters/7/mail/1',
        () => new HttpResponse(null, { status: 204 }),
      ),
      http.get('http://localhost/api/me/characters/7/mail/labels', labelRequests),
    )
    const { mutations, queryCache, unmount } = mountMutations()
    const allMailKey = mailHeadersQuery({ apiClient, characterId }).key
    const inboxKey = mailHeadersQuery({ apiClient, characterId, labels: [1] }).key
    const detailKey = mailDetailQuery({ apiClient, characterId, mailId: 1 }).key
    const labelsKey = mailLabelsQuery({ apiClient, characterId }).key
    for (const key of [allMailKey, inboxKey]) {
      queryCache.setQueryData(key, mailHeaders([mailHeader(1, false)]))
    }
    queryCache.setQueryData(detailKey, mailDetail(false))
    queryCache.setQueryData(labelsKey, mailLabels(1))

    await expect(
      mutations.setMailRead({ characterId, header: mailHeader(1, false), read: true }),
    ).resolves.toEqual({ success: true })

    for (const key of [allMailKey, inboxKey]) {
      expect(
        queryCache.getQueryData<ReturnType<typeof mailHeaders>>(key)?.messages[0]?.isRead,
      ).toBe(true)
    }
    expect(queryCache.getQueryData<ReturnType<typeof mailDetail>>(detailKey)?.isRead).toBe(true)
    expect(queryCache.getQueryData<ReturnType<typeof mailLabels>>(labelsKey)).toMatchObject({
      labels: [{ unreadCount: 0 }],
      totalUnreadCount: 0,
    })
    expect(labelRequests).not.toHaveBeenCalled()
    unmount()
  })

  it('removes a successful deletion from fresh header, detail, and count caches', async () => {
    queryServer.use(
      http.delete(
        'http://localhost/api/me/characters/7/mail/1',
        () => new HttpResponse(null, { status: 204 }),
      ),
    )
    const { mutations, queryCache, unmount } = mountMutations()
    const headersKey = mailHeadersQuery({ apiClient, characterId }).key
    const detailOptions = mailDetailQuery({ apiClient, characterId, mailId: 1 })
    const detailKey = detailOptions.key
    const labelsKey = mailLabelsQuery({ apiClient, characterId }).key
    queryCache.setQueryData(headersKey, mailHeaders([mailHeader(1, false), mailHeader(2, true)]))
    queryCache.ensure(detailOptions)
    queryCache.setQueryData(detailKey, mailDetail(false))
    queryCache.setQueryData(labelsKey, mailLabels(1))

    const outcome = await mutations.deleteMail({ characterId, header: mailHeader(1, false) })
    if (outcome.error) throw outcome.error
    expect(outcome).toEqual({ success: true })

    expect(
      queryCache
        .getQueryData<ReturnType<typeof mailHeaders>>(headersKey)
        ?.messages.map(({ mailId }) => mailId),
    ).toEqual([2])
    expect(queryCache.get(detailKey)?.when).toBe(0)
    expect(queryCache.getQueryData<ReturnType<typeof mailLabels>>(labelsKey)).toMatchObject({
      labels: [{ unreadCount: 0 }],
      totalUnreadCount: 0,
    })
    unmount()
  })

  it('does not let a stale pending header request restore deleted mail', async () => {
    let finishHeaderRequest!: () => void
    let markHeaderRequestStarted!: () => void
    const headerRequestCanFinish = new Promise<void>((resolve) => (finishHeaderRequest = resolve))
    const headerRequestStarted = new Promise<void>(
      (resolve) => (markHeaderRequestStarted = resolve),
    )
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/mail', async () => {
        markHeaderRequestStarted()
        await headerRequestCanFinish
        return HttpResponse.json(mailHeaders([mailHeader(1, false)]))
      }),
      http.delete(
        'http://localhost/api/me/characters/7/mail/1',
        () => new HttpResponse(null, { status: 204 }),
      ),
    )
    const { mutations, queryCache, unmount } = mountMutations()
    const headersOptions = mailHeadersQuery({ apiClient, characterId })
    const headersEntry = queryCache.ensure(headersOptions)
    queryCache.setQueryData(headersOptions.key, mailHeaders([mailHeader(1, false)]))
    const staleRequest = queryCache.fetch(headersEntry).catch(() => undefined)
    await headerRequestStarted

    await expect(
      mutations.deleteMail({ characterId, header: mailHeader(1, false) }),
    ).resolves.toEqual({ success: true })
    finishHeaderRequest()
    await staleRequest

    expect(
      queryCache
        .getQueryData<ReturnType<typeof mailHeaders>>(headersOptions.key)
        ?.messages.map(({ mailId }) => mailId),
    ).toEqual([])
    unmount()
  })

  it('does not cancel a pending older page that does not contain the mutated message', async () => {
    let finishOlderRequest!: () => void
    let markOlderRequestStarted!: () => void
    const olderRequestCanFinish = new Promise<void>((resolve) => (finishOlderRequest = resolve))
    const olderRequestStarted = new Promise<void>((resolve) => (markOlderRequestStarted = resolve))
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/mail', async ({ request }) => {
        if (new URL(request.url).searchParams.get('lastMailId') !== '50') {
          return HttpResponse.json(mailHeaders([mailHeader(1, false)]))
        }
        markOlderRequestStarted()
        await olderRequestCanFinish
        return HttpResponse.json(mailHeaders([mailHeader(49, false)]))
      }),
      http.put(
        'http://localhost/api/me/characters/7/mail/1',
        () => new HttpResponse(null, { status: 204 }),
      ),
    )
    const { mutations, queryCache, unmount } = mountMutations()
    const currentOptions = mailHeadersQuery({ apiClient, characterId })
    const olderOptions = mailHeadersQuery({ apiClient, characterId, lastMailId: 50 })
    queryCache.setQueryData(currentOptions.key, mailHeaders([mailHeader(1, false)]))
    const olderRequest = queryCache.fetch(queryCache.ensure(olderOptions))
    await olderRequestStarted

    await expect(
      mutations.setMailRead({ characterId, header: mailHeader(1, false), read: true }),
    ).resolves.toEqual({ success: true })
    finishOlderRequest()
    await expect(olderRequest).resolves.toMatchObject({ status: 'success' })
    expect(
      queryCache
        .getQueryData<ReturnType<typeof mailHeaders>>(olderOptions.key)
        ?.messages.map(({ mailId }) => mailId),
    ).toEqual([49])
    unmount()
  })

  it('cancels a pending folder query before it can restore deleted mail', async () => {
    let finishFolderRequest!: () => void
    let markFolderRequestStarted!: () => void
    const folderRequestCanFinish = new Promise<void>((resolve) => (finishFolderRequest = resolve))
    const folderRequestStarted = new Promise<void>(
      (resolve) => (markFolderRequestStarted = resolve),
    )
    queryServer.use(
      http.get('http://localhost/api/me/characters/7/mail', async () => {
        markFolderRequestStarted()
        await folderRequestCanFinish
        return HttpResponse.json(mailHeaders([mailHeader(1, false)]))
      }),
      http.delete(
        'http://localhost/api/me/characters/7/mail/1',
        () => new HttpResponse(null, { status: 204 }),
      ),
    )
    const { mutations, queryCache, unmount } = mountMutations()
    const currentOptions = mailHeadersQuery({ apiClient, characterId })
    const folderOptions = mailHeadersQuery({ apiClient, characterId, labels: [1] })
    queryCache.setQueryData(currentOptions.key, mailHeaders([mailHeader(1, false)]))
    const folderRequest = queryCache.fetch(queryCache.ensure(folderOptions)).catch(() => undefined)
    await folderRequestStarted

    await expect(
      mutations.deleteMail({ characterId, header: mailHeader(1, false) }),
    ).resolves.toEqual({ success: true })
    finishFolderRequest()
    await folderRequest

    expect(queryCache.getQueryData(folderOptions.key)).toBeUndefined()
    unmount()
  })

  it('reverts an optimistic read change when EVE refuses it', async () => {
    queryServer.use(
      http.put('http://localhost/api/me/characters/7/mail/1', () =>
        HttpResponse.json(
          { code: 'MAIL_MUTATION_REJECTED', message: 'EVE rejected the mail change.' },
          { status: 409 },
        ),
      ),
    )
    const { mutations, unmount } = mountMutations()

    const outcome = await mutations.setMailRead({
      characterId,
      header: mailHeader(1, false),
      read: true,
    })

    expect(outcome.success).toBe(false)
    expect(outcome.error).toBeInstanceOf(ApiQueryError)
    expect(outcome.error).toMatchObject({ code: 'MAIL_MUTATION_REJECTED', status: 409 })
    expect(mutations.readStateOverrides.value.has(1)).toBe(false)
    unmount()
  })

  it('restores a deleted message when deletion fails', async () => {
    let finishRequest!: () => void
    const requestCanFinish = new Promise<void>((resolve) => (finishRequest = resolve))
    queryServer.use(
      http.delete('http://localhost/api/me/characters/7/mail/1', async () => {
        await requestCanFinish
        return HttpResponse.json(
          { code: 'ESI_UNAVAILABLE', message: 'Unavailable.' },
          { status: 409 },
        )
      }),
    )
    const { mutations, unmount } = mountMutations()

    const request = mutations.deleteMail({ characterId, header: mailHeader(1, false) })
    expect(mutations.deletedMailIds.value.has(1)).toBe(true)

    finishRequest()
    const outcome = await request
    expect(outcome.success).toBe(false)
    expect(mutations.deletedMailIds.value.has(1)).toBe(false)
    unmount()
  })

  it('clears optimistic state and isolates late requests on mailbox reset', async () => {
    let finishRequest!: () => void
    const requestCanFinish = new Promise<void>((resolve) => (finishRequest = resolve))
    queryServer.use(
      http.put('http://localhost/api/me/characters/7/mail/1', async () => {
        await requestCanFinish
        return HttpResponse.json(
          { code: 'MAIL_MUTATION_REJECTED', message: 'EVE rejected the mail change.' },
          { status: 409 },
        )
      }),
    )
    const { mutations, unmount } = mountMutations()

    const request = mutations.setMailRead({
      characterId,
      header: mailHeader(1, false),
      read: true,
    })
    mutations.resetMailMutations()
    expect(mutations.readStateOverrides.value.size).toBe(0)
    expect(mutations.readPendingIds.value.size).toBe(0)

    finishRequest()
    await request
    expect(mutations.readStateOverrides.value.size).toBe(0)
    expect(mutations.readPendingIds.value.size).toBe(0)
    unmount()
  })
})

function mountMutations() {
  let mutations!: ReturnType<typeof useMailMutations>
  const Root = defineComponent({
    setup() {
      mutations = useMailMutations(apiClient)
      return () => h('div')
    },
  })
  const { queryCache, wrapper } = mountWithQueryPlugins(Root)
  return { mutations, queryCache, unmount: () => wrapper.unmount() }
}

function mailHeader(mailId: number, isRead: boolean): MailHeader {
  return {
    isRead,
    labelIds: [1],
    mailId,
    recipients: [],
    sender: null,
    sentAt: '2026-08-28T12:00:00.000Z',
    subject: `Message ${mailId}`,
  }
}

function mailHeaders(messages: MailHeader[]) {
  return { characterId, messages, nextLastMailId: null, ...metadata }
}

function mailDetail(isRead: boolean) {
  return {
    body: 'Message body',
    characterId,
    isRead,
    labelIds: [1],
    mailId: 1,
    recipients: [],
    sender: null,
    sentAt: '2026-08-28T12:00:00.000Z',
    subject: 'Message 1',
    ...metadata,
  }
}

function mailLabels(unreadCount: number) {
  return {
    characterId,
    labels: [{ color: '#ffffff', labelId: 1, name: 'Inbox', unreadCount }],
    totalUnreadCount: unreadCount,
    ...metadata,
  }
}
