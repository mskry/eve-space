import { useQuery } from '@pinia/colada'
import { computed, effectScope, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { MailHeader } from '../../app/queries/mail'
import { useCharacterMailbox } from '../../app/composables/useCharacterMailbox'

vi.mock('@pinia/colada', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pinia/colada')>()),
  useQuery: vi.fn(),
}))

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
        characterId: computed(() => 7),
        createdLabels: ref([]),
        deletedLabelIds,
        deletedMailIds: ref(new Set()),
        deletePendingIds: ref(new Set()),
        labelOverrides: ref(new Map()),
        readStateOverrides: ref(new Map()),
        reconcileCreatedLabels: vi.fn(),
        reconcileLabelState: vi.fn(),
        reconcileReadState: vi.fn(),
      }),
    )!

    expect(mailbox.displayedHeaders.value[0]?.labelIds).toEqual([1])
    expect(mailbox.displayedDetail.value?.labelIds).toEqual([1])
    expect(mailbox.labels.value.map(({ labelId }) => labelId)).toEqual([1])

    deletedLabelIds.value = new Set()
    mailbox.activeLabelId.value = 2
    mailbox.selectMail(1)
    expect(mailbox.displayedHeaders.value).toHaveLength(1)

    mailbox.removeLoadedLabel(2)
    expect(mailbox.displayedHeaders.value).toHaveLength(0)
    expect(mailbox.selectedHeader.value?.labelIds).toEqual([1])
    scope.stop()
  })
})

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
