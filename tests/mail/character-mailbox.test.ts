import { useQuery } from '@pinia/colada'
import { computed, effectScope, nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MailHeader } from '../../app/queries/mail'
import { useCharacterMailbox } from '../../app/composables/useCharacterMailbox'
import { canRunProtectedCharacterQuery } from '../../app/queries/protected-character-query-access'
import { PRIVATE_QUERY_KEYS } from '../../app/queries/query-keys'

vi.mock('@pinia/colada', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pinia/colada')>()),
  useQuery: vi.fn(),
}))
vi.mock('../../app/queries/protected-character-query-access', () => ({
  canRunProtectedCharacterQuery: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(useQuery).mockReset()
  vi.mocked(canRunProtectedCharacterQuery).mockImplementation(
    (access, characterId) =>
      access.authenticationReady &&
      access.authenticated &&
      access.ownsCharacter &&
      Number.isSafeInteger(characterId) &&
      characterId > 0,
  )
})

describe('character mailbox', () => {
  it('keeps deleted labels out of stale headers, details, labels, and loaded pages', () => {
    const headers = queryState({
      characterId: 7,
      messages: [mailHeader(1, [1, 2])],
      nextLastMailId: null,
    })
    const labels = queryState({
      characterId: 7,
      labels: [
        { color: '#ffffff', labelId: 1, name: 'Inbox', unreadCount: 0 },
        { color: '#999999', labelId: 2, name: 'Archive', unreadCount: 0 },
      ],
      totalUnreadCount: 0,
    })
    const lists = queryState({ characterId: 7, mailingLists: [] })
    const cursor = queryState(undefined)
    const detail = queryState({ ...mailHeader(1, [1, 2]), body: 'Message body', characterId: 7 })
    vi.mocked(useQuery)
      .mockReturnValueOnce(headers as never)
      .mockReturnValueOnce(labels as never)
      .mockReturnValueOnce(lists as never)
      .mockReturnValueOnce(cursor as never)
      .mockReturnValueOnce(detail as never)

    const deletedLabelIds = ref(new Set([2]))
    const scope = effectScope()
    const mailbox = scope.run(() =>
      useCharacterMailbox({
        apiClient: {} as never,
        authenticated: computed(() => true),
        authenticationReady: computed(() => true),
        characterId: computed(() => 7),
        createdLabels: ref([]),
        deletePendingIds: ref(new Set()),
        deletedLabelIds,
        deletedMailIds: ref(new Set()),
        labelOverrides: ref(new Map()),
        ownsCharacter: computed(() => true),
        readStateOverrides: ref(new Map()),
        reconcileCreatedLabels: vi.fn(),
        reconcileLabelState: vi.fn(),
        reconcileReadState: vi.fn(),
      }),
    )!

    expect(mailbox.displayedHeaders.value[0]?.labelIds).toStrictEqual([1])
    expect(mailbox.displayedDetail.value?.labelIds).toStrictEqual([1])
    expect(mailbox.labels.value.map(({ labelId }) => labelId)).toStrictEqual([1])

    deletedLabelIds.value = new Set()
    mailbox.activeLabelId.value = 2
    mailbox.selectMail(1)
    expect(mailbox.displayedHeaders.value).toHaveLength(1)

    mailbox.removeLoadedLabel(2)
    expect(mailbox.displayedHeaders.value).toHaveLength(0)
    expect(mailbox.selectedHeader.value?.labelIds).toStrictEqual([1])
    scope.stop()
  })

  it('gates every query until client authentication and character ownership are ready', () => {
    vi.mocked(useQuery)
      .mockReturnValueOnce(
        queryState({ characterId: 7, messages: [], nextLastMailId: 99 }) as never,
      )
      .mockReturnValueOnce(queryState({ characterId: 7, labels: [], totalUnreadCount: 0 }) as never)
      .mockReturnValueOnce(queryState({ characterId: 7, mailingLists: [] }) as never)
      .mockReturnValueOnce(queryState(undefined) as never)
      .mockReturnValueOnce(queryState(undefined) as never)

    const authenticated = ref(false)
    const authenticationReady = ref(false)
    const characterId = ref<number>()
    const ownsCharacter = ref(false)
    const scope = effectScope()
    const mailbox = scope.run(() =>
      useCharacterMailbox({
        apiClient: {} as never,
        authenticated: computed(() => authenticated.value),
        authenticationReady: computed(() => authenticationReady.value),
        characterId: computed(() => characterId.value),
        createdLabels: ref([]),
        deletePendingIds: ref(new Set()),
        deletedLabelIds: ref(new Set()),
        deletedMailIds: ref(new Set()),
        labelOverrides: ref(new Map()),
        ownsCharacter: computed(() => ownsCharacter.value),
        readStateOverrides: ref(new Map()),
        reconcileCreatedLabels: vi.fn(),
        reconcileLabelState: vi.fn(),
        reconcileReadState: vi.fn(),
      }),
    )!
    const options = capturedQueryOptions()
    const enabled = () => options.map((queryOptions) => queryOptions().enabled)

    expect(enabled()).toStrictEqual([false, false, false, false, false])
    authenticationReady.value = true
    authenticated.value = true
    characterId.value = 7
    expect(enabled()).toStrictEqual([false, false, false, false, false])

    ownsCharacter.value = true
    expect(enabled()).toStrictEqual([true, true, true, false, false])

    mailbox.selectMail(42)
    expect(enabled()).toStrictEqual([true, true, true, false, true])

    mailbox.nextLastMailId.value = 99
    mailbox.loadOlder()
    expect(enabled()).toStrictEqual([true, true, true, true, true])
    scope.stop()
  })

  it('puts labels in request identity while keeping search and unread filters local', () => {
    vi.mocked(useQuery)
      .mockReturnValueOnce(
        queryState({ characterId: 7, messages: [], nextLastMailId: null }) as never,
      )
      .mockReturnValueOnce(queryState({ characterId: 7, labels: [], totalUnreadCount: 0 }) as never)
      .mockReturnValueOnce(queryState({ characterId: 7, mailingLists: [] }) as never)
      .mockReturnValueOnce(queryState(undefined) as never)
      .mockReturnValueOnce(queryState(undefined) as never)

    const scope = effectScope()
    const mailbox = scope.run(() =>
      useCharacterMailbox({
        apiClient: {} as never,
        authenticated: computed(() => true),
        authenticationReady: computed(() => true),
        characterId: computed(() => 7),
        createdLabels: ref([]),
        deletePendingIds: ref(new Set()),
        deletedLabelIds: ref(new Set()),
        deletedMailIds: ref(new Set()),
        labelOverrides: ref(new Map()),
        ownsCharacter: computed(() => true),
        readStateOverrides: ref(new Map()),
        reconcileCreatedLabels: vi.fn(),
        reconcileLabelState: vi.fn(),
        reconcileReadState: vi.fn(),
      }),
    )!
    const [headersOptions] = capturedQueryOptions()

    mailbox.selectLabel(2)
    expect(headersOptions!().key).toStrictEqual(PRIVATE_QUERY_KEYS.mailHeaders(7, [2], null))
    expect(mailbox.headerEmptyMessage.value).toBe('There are no messages in this folder.')

    mailbox.selectLabel(null)
    mailbox.search.value = 'priority'
    mailbox.unreadOnly.value = true
    expect(headersOptions!().key).toStrictEqual(PRIVATE_QUERY_KEYS.mailHeaders(7, [], null))
    expect(mailbox.headerEmptyMessage.value).toBe(
      'No matches in loaded messages. Load older messages to search further.',
    )
    scope.stop()
  })

  it('clears copied mailbox state when private query data is purged', async () => {
    const headers = queryState({
      characterId: 7,
      messages: [mailHeader(1, [1])],
      nextLastMailId: 99,
    })
    vi.mocked(useQuery)
      .mockReturnValueOnce(headers as never)
      .mockReturnValueOnce(queryState({ characterId: 7, labels: [], totalUnreadCount: 0 }) as never)
      .mockReturnValueOnce(queryState({ characterId: 7, mailingLists: [] }) as never)
      .mockReturnValueOnce(queryState(undefined) as never)
      .mockReturnValueOnce(queryState(undefined) as never)

    const scope = effectScope()
    const mailbox = scope.run(() =>
      useCharacterMailbox({
        apiClient: {} as never,
        authenticated: computed(() => true),
        authenticationReady: computed(() => true),
        characterId: computed(() => 7),
        createdLabels: ref([]),
        deletePendingIds: ref(new Set()),
        deletedLabelIds: ref(new Set()),
        deletedMailIds: ref(new Set()),
        labelOverrides: ref(new Map()),
        ownsCharacter: computed(() => true),
        readStateOverrides: ref(new Map()),
        reconcileCreatedLabels: vi.fn(),
        reconcileLabelState: vi.fn(),
        reconcileReadState: vi.fn(),
      }),
    )!
    expect(mailbox.displayedHeaders.value).toHaveLength(1)
    mailbox.selectMail(1)

    headers.data.value = undefined
    await nextTick()

    expect(mailbox.displayedHeaders.value).toStrictEqual([])
    expect(mailbox.nextLastMailId.value).toBeNull()
    expect(mailbox.selectedMailId.value).toBeNull()

    mailbox.activeLabelId.value = 2
    mailbox.search.value = 'private subject'
    mailbox.unreadOnly.value = true
    mailbox.selectedMailingListId.value = 77
    mailbox.resetMailboxPrivateState()
    expect(mailbox.activeLabelId.value).toBeNull()
    expect(mailbox.search.value).toBe('')
    expect(mailbox.unreadOnly.value).toBe(false)
    expect(mailbox.selectedMailingListId.value).toBeNull()
    scope.stop()
  })
})

function capturedQueryOptions() {
  return vi.mocked(useQuery).mock.calls.map(
    ([options]) =>
      options as unknown as () => {
        enabled: boolean
        key: readonly unknown[]
      },
  )
}

function queryState<T>(data: T) {
  return {
    asyncStatus: ref<'idle' | 'loading'>('idle'),
    data: ref(data),
    error: ref<unknown>(),
    refetch: vi.fn(),
  }
}

function mailHeader(mailId: number, labelIds: number[]): MailHeader {
  return {
    isRead: true,
    labelIds,
    mailId,
    recipients: [],
    sender: null,
    sentAt: '2026-08-28T12:00:00.000Z',
    subject: `Message ${mailId}`,
  }
}
