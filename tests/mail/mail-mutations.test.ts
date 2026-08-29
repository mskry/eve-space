import { http, HttpResponse } from 'msw'
import { defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useMailOrganizationMutations } from '../../app/composables/useMailOrganizationMutations'
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

  it('retains a label override until retrieved message data agrees', async () => {
    const labelRequests = vi.fn()
    queryServer.use(
      http.put(
        'http://localhost/api/me/characters/7/mail/1',
        () => new HttpResponse(null, { status: 204 }),
      ),
      http.get('http://localhost/api/me/characters/7/mail/labels', labelRequests),
    )
    const { mutations, queryCache, unmount } = mountMutations()
    const headersKey = mailHeadersQuery({ apiClient, characterId }).key
    const detailKey = mailDetailQuery({ apiClient, characterId, mailId: 1 }).key
    queryCache.setQueryData(headersKey, mailHeaders([mailHeader(1, false)]))
    queryCache.setQueryData(detailKey, mailDetail(false))

    await expect(
      mutations.assignMailLabels({
        characterId,
        header: mailHeader(1, false),
        labels: [1, 2],
      }),
    ).resolves.toEqual({ success: true })
    expect(mutations.labelOverrides.value.get(1)).toEqual([1, 2])
    expect(queryCache.getQueryData<ReturnType<typeof mailDetail>>(detailKey)?.labelIds).toEqual([
      1, 2,
    ])

    await Promise.resolve()
    mutations.reconcileLabelState([mailHeader(1, false)])
    expect(mutations.labelOverrides.value.get(1)).toEqual([1, 2])
    mutations.reconcileLabelState([mailHeader(1, false, [2, 1])])
    expect(mutations.labelOverrides.value.has(1)).toBe(false)
    expect(labelRequests).not.toHaveBeenCalled()
    unmount()
  })

  it('evicts label-filtered caches whose membership changes', async () => {
    queryServer.use(
      http.put(
        'http://localhost/api/me/characters/7/mail/1',
        () => new HttpResponse(null, { status: 204 }),
      ),
    )
    const { mutations, queryCache, unmount } = mountMutations()
    const allMailKey = mailHeadersQuery({ apiClient, characterId }).key
    const inboxKey = mailHeadersQuery({ apiClient, characterId, labels: [1] }).key
    const priorityKey = mailHeadersQuery({ apiClient, characterId, labels: [2] }).key
    const unrelatedKey = mailHeadersQuery({ apiClient, characterId, labels: [3] }).key
    queryCache.setQueryData(allMailKey, mailHeaders([mailHeader(1, false)]))
    queryCache.setQueryData(inboxKey, mailHeaders([mailHeader(1, false)]))
    queryCache.setQueryData(priorityKey, mailHeaders([mailHeader(2, true, [2])]))
    queryCache.setQueryData(unrelatedKey, mailHeaders([mailHeader(3, true, [3])]))

    await expect(
      mutations.assignMailLabels({
        characterId,
        header: mailHeader(1, false),
        labels: [2],
      }),
    ).resolves.toEqual({ success: true })

    expect(
      queryCache
        .getQueryData<ReturnType<typeof mailHeaders>>(inboxKey)
        ?.messages.map(({ mailId }) => mailId),
    ).toEqual([])
    expect(
      queryCache
        .getQueryData<ReturnType<typeof mailHeaders>>(priorityKey)
        ?.messages.map(({ mailId }) => mailId),
    ).toEqual([2, 1])
    expect(
      queryCache.getQueryData<ReturnType<typeof mailHeaders>>(allMailKey)?.messages[0]?.labelIds,
    ).toEqual([2])
    expect(
      queryCache
        .getQueryData<ReturnType<typeof mailHeaders>>(unrelatedKey)
        ?.messages.map(({ mailId }) => mailId),
    ).toEqual([3])
    unmount()
  })

  it('retains a created label until retrieved label data includes it', async () => {
    queryServer.use(
      http.post('http://localhost/api/me/characters/7/mail/labels', () =>
        HttpResponse.json({ characterId, labelId: 2 }, { status: 201 }),
      ),
    )
    const { mutations, queryCache, unmount } = mountMutations()
    const labelsKey = mailLabelsQuery({ apiClient, characterId }).key
    const staleLabels = mailLabels(1)
    queryCache.setQueryData(labelsKey, staleLabels)

    await expect(
      mutations.createMailLabel({ characterId, color: '#fe0000', name: 'Priority' }),
    ).resolves.toEqual({ success: true })
    expect(mutations.createdLabels.value).toEqual([
      { color: '#fe0000', labelId: 2, name: 'Priority', unreadCount: 0 },
    ])
    expect(
      queryCache
        .getQueryData<ReturnType<typeof mailLabels>>(labelsKey)
        ?.labels.map(({ labelId }) => labelId),
    ).toEqual([1, 2])

    await Promise.resolve()
    mutations.reconcileCreatedLabels(staleLabels.labels)
    expect(mutations.createdLabels.value).toHaveLength(1)
    mutations.reconcileCreatedLabels([
      ...staleLabels.labels,
      { color: '#fe0000', labelId: 2, name: 'Priority', unreadCount: 0 },
    ])
    expect(mutations.createdLabels.value).toHaveLength(0)
    unmount()
  })

  it('removes a deleted label from label, header, detail, and override state', async () => {
    queryServer.use(
      http.delete(
        'http://localhost/api/me/characters/7/mail/labels/2',
        () => new HttpResponse(null, { status: 204 }),
      ),
    )
    const { mutations, queryCache, unmount } = mountMutations()
    const headersKey = mailHeadersQuery({ apiClient, characterId }).key
    const detailKey = mailDetailQuery({ apiClient, characterId, mailId: 1 }).key
    const labelsKey = mailLabelsQuery({ apiClient, characterId }).key
    queryCache.setQueryData(headersKey, mailHeaders([mailHeader(1, false, [1, 2])]))
    queryCache.setQueryData(detailKey, { ...mailDetail(false), labelIds: [1, 2] })
    queryCache.setQueryData(labelsKey, {
      ...mailLabels(1),
      labels: [
        { color: '#ffffff', labelId: 1, name: 'Inbox', unreadCount: 1 },
        { color: '#fe0000', labelId: 2, name: 'Priority', unreadCount: 1 },
      ],
    })
    mutations.labelOverrides.value = new Map([[1, [1, 2]]])

    await expect(mutations.deleteMailLabel({ characterId, labelId: 2 })).resolves.toEqual({
      success: true,
    })

    expect(
      queryCache.getQueryData<ReturnType<typeof mailHeaders>>(headersKey)?.messages[0]?.labelIds,
    ).toEqual([1])
    expect(queryCache.getQueryData<ReturnType<typeof mailDetail>>(detailKey)?.labelIds).toEqual([1])
    expect(
      queryCache
        .getQueryData<ReturnType<typeof mailLabels>>(labelsKey)
        ?.labels.map(({ labelId }) => labelId),
    ).toEqual([1])
    expect(mutations.labelOverrides.value.get(1)).toEqual([1])
    unmount()
  })

  it('blocks label deletion while an assignment is pending', async () => {
    let finishAssignment!: () => void
    const assignmentCanFinish = new Promise<void>((resolve) => (finishAssignment = resolve))
    const deleteRequests = vi.fn()
    queryServer.use(
      http.put('http://localhost/api/me/characters/7/mail/1', async () => {
        await assignmentCanFinish
        return new HttpResponse(null, { status: 204 })
      }),
      http.delete('http://localhost/api/me/characters/7/mail/labels/2', deleteRequests),
    )
    const { mutations, unmount } = mountMutations()

    const assignment = mutations.assignMailLabels({
      characterId,
      header: mailHeader(1, false),
      labels: [1, 2],
    })
    await expect(mutations.deleteMailLabel({ characterId, labelId: 2 })).resolves.toEqual({
      success: false,
    })
    expect(deleteRequests).not.toHaveBeenCalled()

    finishAssignment()
    await expect(assignment).resolves.toEqual({ success: true })
    unmount()
  })

  it('blocks label assignment while a deletion is pending', async () => {
    let finishDeletion!: () => void
    const deletionCanFinish = new Promise<void>((resolve) => (finishDeletion = resolve))
    const assignmentRequests = vi.fn()
    queryServer.use(
      http.delete('http://localhost/api/me/characters/7/mail/labels/2', async () => {
        await deletionCanFinish
        return new HttpResponse(null, { status: 204 })
      }),
      http.put('http://localhost/api/me/characters/7/mail/1', assignmentRequests),
    )
    const { mutations, unmount } = mountMutations()

    const deletion = mutations.deleteMailLabel({ characterId, labelId: 2 })
    await expect(
      mutations.assignMailLabels({
        characterId,
        header: mailHeader(1, false),
        labels: [1, 2],
      }),
    ).resolves.toEqual({ success: false })
    expect(assignmentRequests).not.toHaveBeenCalled()

    finishDeletion()
    await expect(deletion).resolves.toEqual({ success: true })
    unmount()
  })

  it.each(['labels-first', 'read-first'] as const)(
    'composes concurrent read and label writes when %s completes',
    async (completionOrder) => {
      let finishRead!: () => void
      let finishLabels!: () => void
      const readCanFinish = new Promise<void>((resolve) => (finishRead = resolve))
      const labelsCanFinish = new Promise<void>((resolve) => (finishLabels = resolve))
      const requestBodies: unknown[] = []
      queryServer.use(
        http.put('http://localhost/api/me/characters/7/mail/1', async ({ request }) => {
          const body = await request.json()
          requestBodies.push(body)
          if ('read' in (body as object)) await readCanFinish
          else await labelsCanFinish
          return new HttpResponse(null, { status: 204 })
        }),
      )
      const { mutations, queryCache, unmount } = mountMutations()
      const headersKey = mailHeadersQuery({ apiClient, characterId }).key
      const detailKey = mailDetailQuery({ apiClient, characterId, mailId: 1 }).key
      const labelsKey = mailLabelsQuery({ apiClient, characterId }).key
      queryCache.setQueryData(headersKey, mailHeaders([mailHeader(1, false)]))
      queryCache.setQueryData(detailKey, mailDetail(false))
      queryCache.setQueryData(labelsKey, {
        ...mailLabels(1),
        labels: [
          { color: '#ffffff', labelId: 1, name: 'Inbox', unreadCount: 1 },
          { color: '#fe0000', labelId: 2, name: 'Priority', unreadCount: 0 },
        ],
      })

      const readRequest = mutations.setMailRead({
        characterId,
        header: mailHeader(1, false),
        read: true,
      })
      const labelRequest = mutations.assignMailLabels({
        characterId,
        header: mailHeader(1, false),
        labels: [2],
      })
      await vi.waitFor(() => expect(requestBodies).toHaveLength(2))
      expect(mutations.readPendingIds.value.has(1)).toBe(true)
      expect(mutations.labelPendingIds.value.has(1)).toBe(true)

      if (completionOrder === 'labels-first') {
        finishLabels()
        await labelRequest
        finishRead()
      } else {
        finishRead()
        await readRequest
        finishLabels()
      }
      await Promise.all([readRequest, labelRequest])

      expect(queryCache.getQueryData<ReturnType<typeof mailDetail>>(detailKey)).toMatchObject({
        isRead: true,
        labelIds: [2],
      })
      expect(queryCache.getQueryData<ReturnType<typeof mailLabels>>(labelsKey)).toMatchObject({
        labels: [{ unreadCount: 0 }, { unreadCount: 0 }],
        totalUnreadCount: 0,
      })
      unmount()
    },
  )

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
    mutations.labelOverrides.value = new Map([[1, [1, 2]]])
    mutations.createdLabels.value = [
      { color: '#fe0000', labelId: 2, name: 'Priority', unreadCount: 0 },
    ]
    mutations.undeletableLabelIds.value = new Set([1])
    mutations.resetMailMutations()
    expect(mutations.readStateOverrides.value.size).toBe(0)
    expect(mutations.readPendingIds.value.size).toBe(0)
    expect(mutations.labelOverrides.value.size).toBe(0)
    expect(mutations.createdLabels.value).toHaveLength(0)
    expect(mutations.undeletableLabelIds.value.size).toBe(0)

    finishRequest()
    await request
    expect(mutations.readStateOverrides.value.size).toBe(0)
    expect(mutations.readPendingIds.value.size).toBe(0)
    unmount()
  })
})

function mountMutations() {
  let mutations!: ReturnType<typeof useMailOrganizationMutations>
  const Root = defineComponent({
    setup() {
      mutations = useMailOrganizationMutations(apiClient)
      return () => h('div')
    },
  })
  const { queryCache, wrapper } = mountWithQueryPlugins(Root)
  return { mutations, queryCache, unmount: () => wrapper.unmount() }
}

function mailHeader(
  mailId: number,
  isRead: boolean,
  labelIds: readonly number[] = [1],
): MailHeader {
  return {
    isRead,
    labelIds,
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
