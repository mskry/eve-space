import { http, HttpResponse } from 'msw'
import { computed, defineComponent, h, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useMailOrganization } from '../../app/composables/useMailOrganization'
import { useMailOrganizationMutations } from '../../app/composables/useMailOrganizationMutations'
import type { useCharacterMailbox } from '../../app/composables/useCharacterMailbox'
import type { MailDetail, MailHeader, MailLabel } from '../../app/queries/mail'
import { createApiClient } from '../../app/utils/api-client'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'

const apiClient = createApiClient('http://localhost')
const characterId = 7
const priorityLabel: MailLabel = {
  color: '#fe0000',
  labelId: 2,
  name: 'Priority',
  unreadCount: 0,
}

describe('mail label management', () => {
  it('opens management and assignment surfaces and resets a successful create form', async () => {
    queryServer.use(
      http.post('http://localhost/api/me/characters/7/mail/labels', () =>
        HttpResponse.json({ characterId, labelId: 3 }, { status: 201 }),
      ),
    )
    const harness = mountOrganization()
    harness.organization.createLabelFeedback.value = 'Previous outcome'
    harness.organization.openLabelManagement()
    expect(harness.organization.labelManagementOpen.value).toBe(true)
    expect(harness.organization.createLabelFeedback.value).toBe('')
    harness.organization.openLabelAssignment()
    expect(harness.organization.labelAssignmentOpen.value).toBe(true)
    harness.organization.labelName.value = 'Priority'
    harness.organization.labelColor.value = '#fe0000'

    await harness.organization.createLabel()

    expect(harness.organization.labelName.value).toBe('')
    expect(harness.organization.labelColor.value).toBeUndefined()
    expect(harness.mutations.createdLabels.value).toEqual([
      { color: '#fe0000', labelId: 3, name: 'Priority', unreadCount: 0 },
    ])
    expect(harness.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Label created' }),
    )
    harness.unmount()
  })

  it('preserves the create form and lists no label when EVE refuses creation', async () => {
    queryServer.use(
      http.post('http://localhost/api/me/characters/7/mail/labels', () =>
        HttpResponse.json(
          { code: 'MAIL_MUTATION_REJECTED', message: 'EVE rejected the mail change.' },
          { status: 409 },
        ),
      ),
    )
    const harness = mountOrganization()
    harness.organization.labelName.value = 'Priority'
    harness.organization.labelColor.value = '#fe0000'

    await harness.organization.createLabel()

    expect(harness.organization.labelName.value).toBe('Priority')
    expect(harness.organization.labelColor.value).toBe('#fe0000')
    expect(harness.mutations.createdLabels.value).toHaveLength(0)
    expect(harness.organization.createLabelFeedback.value).toContain('rejected')
    expect(harness.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Mail change refused' }),
    )
    harness.unmount()
  })

  it('offers reauthorization for a label write without hiding mailbox state', async () => {
    queryServer.use(
      http.post('http://localhost/api/me/characters/7/mail/labels', () =>
        HttpResponse.json(
          {
            authorizeUrl: 'http://localhost/auth/eve/reauthorize/7',
            code: 'EVE_SCOPE_REQUIRED',
            message: 'Authorize mail organization.',
          },
          { status: 403 },
        ),
      ),
    )
    const harness = mountOrganization()
    harness.organization.labelName.value = 'Priority'

    await harness.organization.createLabel()

    expect(harness.mailbox.displayedHeaders.value).toHaveLength(1)
    expect(harness.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        actionHref: 'http://localhost/auth/eve/reauthorize/7',
        title: 'Mail organization authorization required',
      }),
    )
    harness.unmount()
  })

  it('records a refused deletion as an undeletable label instead of an error', async () => {
    queryServer.use(
      http.delete('http://localhost/api/me/characters/7/mail/labels/2', () =>
        HttpResponse.json(
          { code: 'MAIL_MUTATION_REJECTED', message: 'EVE rejected the mail change.' },
          { status: 409 },
        ),
      ),
    )
    const harness = mountOrganization()

    harness.organization.requestLabelDeletion(priorityLabel)
    const confirmation = lastConfirmation(harness.openConfirmDialog)
    expect(confirmation.description).toContain('Priority')
    expect(confirmation.description).toContain('every message carrying it')
    await confirmation.onConfirm()

    expect(harness.mutations.undeletableLabelIds.value.has(2)).toBe(true)
    expect(harness.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Label cannot be deleted' }),
    )
    expect(harness.showToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Label change reverted' }),
    )
    harness.unmount()
  })

  it('returns to all mail after deleting the selected label', async () => {
    queryServer.use(
      http.delete(
        'http://localhost/api/me/characters/7/mail/labels/2',
        () => new HttpResponse(null, { status: 204 }),
      ),
    )
    const harness = mountOrganization()
    harness.mailbox.activeLabelId.value = 2

    harness.organization.requestLabelDeletion(priorityLabel)
    await lastConfirmation(harness.openConfirmDialog).onConfirm()

    expect(harness.mailbox.selectLabel).toHaveBeenCalledWith(null)
    expect(harness.mailbox.removeLoadedLabel).toHaveBeenCalledWith(2)
    harness.unmount()
  })

  it('adds and removes one label while retaining the complete detail-sourced set', async () => {
    const requestBodies: unknown[] = []
    queryServer.use(
      http.put('http://localhost/api/me/characters/7/mail/1', async ({ request }) => {
        requestBodies.push(await request.json())
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const harness = mountOrganization([1, 2])

    await harness.organization.changeOpenMessageLabel(3, true)
    await harness.organization.changeOpenMessageLabel(2, false)

    expect(requestBodies).toEqual([{ labels: [1, 2, 3] }, { labels: [1, 3] }])
    expect(requestBodies.every((body) => !Object.hasOwn(body as object, 'read'))).toBe(true)
    harness.unmount()
  })

  it('excludes deleted labels from a stale detail when assigning another label', async () => {
    const requestBodies: unknown[] = []
    queryServer.use(
      http.put('http://localhost/api/me/characters/7/mail/1', async ({ request }) => {
        requestBodies.push(await request.json())
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const harness = mountOrganization([1, 2])
    harness.mutations.deletedLabelIds.value = new Set([2])

    await harness.organization.changeOpenMessageLabel(3, true)

    expect(requestBodies).toEqual([{ labels: [1, 3] }])
    expect(harness.organization.assignedLabelIds.value).toEqual(new Set([1, 3]))
    harness.unmount()
  })

  it('keeps a selected message deletable after it leaves the active folder', async () => {
    queryServer.use(
      http.delete(
        'http://localhost/api/me/characters/7/mail/1',
        () => new HttpResponse(null, { status: 204 }),
      ),
    )
    const harness = mountOrganization([1, 2])
    harness.mailbox.displayedHeaders.value = []

    harness.organization.requestMailDeletion()
    await lastConfirmation(harness.openConfirmDialog).onConfirm()

    expect(harness.mailbox.removeLoadedHeader).toHaveBeenCalledWith(1)
    expect(harness.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Message deleted' }),
    )
    harness.unmount()
  })

  it('keeps message deletion pending while its label assignment is in flight', async () => {
    const harness = mountOrganization()
    harness.organization.requestMailDeletion()
    const confirmation = lastConfirmation(harness.openConfirmDialog)
    harness.mutations.labelPendingIds.value = new Set([1])

    expect(confirmation.pending()).toBe(true)
    expect(confirmation.pendingLabel()).toBe('Waiting for mail update...')
    await expect(confirmation.onConfirm()).resolves.toBe(false)
    expect(harness.mutations.deletePendingIds.value.size).toBe(0)
    harness.unmount()
  })

  it('reverts an optimistic assignment and discloses a refused change', async () => {
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
    const harness = mountOrganization([1])

    const request = harness.organization.changeOpenMessageLabel(2, true)
    expect(harness.mutations.labelOverrides.value.get(1)).toEqual([1, 2])
    finishRequest()
    await request

    expect(harness.mutations.labelOverrides.value.has(1)).toBe(false)
    expect(harness.organization.assignmentFeedback.value).toContain('rejected')
    expect(harness.mailbox.displayedHeaders.value).toHaveLength(1)
    harness.unmount()
  })

  it('requires loaded detail and enforces the 25 unique label limit before writing', async () => {
    const requests = vi.fn()
    queryServer.use(
      http.put('http://localhost/api/me/characters/7/mail/1', () => {
        requests()
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const harness = mountOrganization(Array.from({ length: 25 }, (_, index) => index + 1))

    await harness.organization.changeOpenMessageLabel(26, true)
    expect(harness.organization.assignmentFeedback.value).toContain('at most 25 unique labels')
    expect(requests).not.toHaveBeenCalled()

    harness.mailbox.detailQuery.data.value = undefined
    await harness.organization.changeOpenMessageLabel(1, false)
    expect(harness.organization.assignmentFeedback.value).toContain('complete message')
    expect(requests).not.toHaveBeenCalled()
    harness.unmount()
  })
})

function mountOrganization(labelIds: number[] = [1]) {
  const openConfirmDialog = vi.fn()
  const showToast = vi.fn(() => 1)
  const dismissToast = vi.fn()
  vi.stubGlobal('useConfirmDialog', () => ({ openConfirmDialog }))
  vi.stubGlobal('useToast', () => ({ dismissToast, showToast }))
  const id = ref<number | undefined>(characterId)
  const activeLabelId = ref<number | null>(null)
  const selectedMailId = ref<number | null>(1)
  const detail = ref<MailDetail | undefined>(mailDetail(labelIds))
  const headers = ref<MailHeader[]>([mailHeader(labelIds)])
  const selectedHeader = ref<MailHeader>(mailHeader(labelIds))
  const selectLabel = vi.fn((labelId: number | null) => {
    activeLabelId.value = labelId
  })
  const mailbox = {
    activeLabelId,
    detailQuery: { data: detail, error: ref<unknown>() },
    displayedDetail: computed(() => {
      const value = detail.value
      if (!value) return undefined
      const overridden = mutations?.labelOverrides.value.get(value.mailId) ?? value.labelIds
      return {
        ...value,
        labelIds: overridden.filter((labelId) => !mutations?.deletedLabelIds.value.has(labelId)),
      }
    }),
    displayedHeaders: headers,
    removeLoadedHeader: vi.fn(),
    removeLoadedLabel: vi.fn(),
    selectLabel,
    selectedHeader: computed(() =>
      selectedMailId.value === selectedHeader.value.mailId ? selectedHeader.value : undefined,
    ),
    selectedMailId,
  } as unknown as ReturnType<typeof useCharacterMailbox>
  let mutations!: ReturnType<typeof useMailOrganizationMutations>
  let organization!: ReturnType<typeof useMailOrganization>
  const Root = defineComponent({
    setup() {
      mutations = useMailOrganizationMutations(apiClient)
      organization = useMailOrganization({
        characterId: computed(() => id.value),
        mailbox,
        mutations,
      })
      return () => h('div')
    },
  })
  const { wrapper } = mountWithQueryPlugins(Root)
  return {
    mailbox,
    mutations,
    openConfirmDialog,
    organization,
    showToast,
    unmount: () => {
      wrapper.unmount()
      vi.unstubAllGlobals()
    },
  }
}

function lastConfirmation(openConfirmDialog: ReturnType<typeof vi.fn>) {
  const value = openConfirmDialog.mock.calls.at(-1)?.[0] as {
    description: string
    onConfirm: () => Promise<boolean>
    pending: () => boolean
    pendingLabel: () => string
  }
  expect(value).toBeDefined()
  return value
}

function mailHeader(labelIds: number[]): MailHeader {
  return {
    isRead: true,
    labelIds,
    mailId: 1,
    recipients: [],
    sender: null,
    sentAt: '2026-08-29T12:00:00.000Z',
    subject: 'Message 1',
  }
}

function mailDetail(labelIds: number[]): MailDetail {
  return {
    ...mailHeader(labelIds),
    body: 'Message body',
    cachedUntil: '2026-08-29T12:00:30.000Z',
    characterId,
    quota: {},
    source: 'esi',
    stale: false,
  }
}
