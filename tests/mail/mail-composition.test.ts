import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { http, HttpResponse } from 'msw'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  MAIL_BODY_LIMIT,
  MAIL_RECIPIENT_LIMIT,
  MAIL_RECIPIENT_SEARCH_MIN_LENGTH,
  MAIL_SUBJECT_LIMIT,
  seedMailComposition,
  useMailComposition,
} from '../../app/composables/useMailComposition'
import type { MailDetail } from '../../app/queries/mail'
import { createApiClient } from '../../app/utils/api-client'
import { mountWithQueryPlugins } from '../support/mount-with-query-plugins'
import { queryServer } from '../support/query-server'

const readWorkspaceFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('mail composition', () => {
  it('seeds reply from the addressable sender and quotes plain text', () => {
    const seed = seedMailComposition('reply', mailDetail(), 7)

    expect(seed.recipients).toEqual([{ id: 91, type: 'corporation', name: 'Operations Control' }])
    expect(seed.subject).toBe('Re: Priority operations update')
    expect(seed.body).toContain('--- Original message from Operations Control ---')
    expect(seed.body).toContain('Plain message body')
    expect(seed.omitted).toEqual([])
  })

  it('seeds reply-all without the open character and deduplicates typed recipients', () => {
    const detail = mailDetail({
      recipients: [
        { id: 7, type: 'character', name: 'Reading Pilot' },
        { id: 44, type: 'character', name: 'Wingmate' },
        { id: 44, type: 'character', name: 'Wingmate' },
        { id: 77, type: 'mailing_list', name: null },
      ],
    })

    expect(seedMailComposition('reply-all', detail, 7).recipients).toEqual([
      { id: 91, type: 'corporation', name: 'Operations Control' },
      { id: 44, type: 'character', name: 'Wingmate' },
      { id: 77, type: 'mailing_list', name: null },
    ])
  })

  it('seeds forward without recipients', () => {
    const seed = seedMailComposition('forward', mailDetail(), 7)

    expect(seed.recipients).toEqual([])
    expect(seed.subject).toBe('Fwd: Priority operations update')
    expect(seed.body).toContain('Plain message body')
  })

  it.each([
    ['reply', [], ['Unknown unknown #91']],
    ['reply-all', [{ id: 44, type: 'character', name: null }], ['Unknown unknown #91']],
    ['forward', [], []],
  ] as const)(
    'never seeds an unknown sender in %s mode',
    (mode, expectedRecipients, expectedOmissions) => {
      const detail = mailDetail({
        sender: { id: 91, type: 'unknown', name: null },
        recipients: [{ id: 44, type: 'character', name: null }],
      })
      const seed = seedMailComposition(mode, detail, 7)

      expect(seed.recipients).not.toContainEqual(expect.objectContaining({ id: 91 }))
      expect(seed.recipients).toEqual(expectedRecipients)
      expect(seed.omitted).toEqual(expectedOmissions)
    },
  )

  it('keeps draft state outside query and browser storage', () => {
    const composition = readWorkspaceFile('app/composables/useMailComposition.ts')
    const page = readWorkspaceFile('app/pages/characters/[characterId]/mail.vue')

    expect(composition).toContain('const recipients = ref<MailRecipient[]>([])')
    expect(composition).toContain("const subject = ref('')")
    expect(composition).toContain("const body = ref('')")
    expect(composition).not.toMatch(/localStorage|sessionStorage|setQueryData/)
    expect(composition).toContain("watch(options.characterId, resetDraft, { flush: 'sync' })")
    expect(page).toContain('useMailComposition({')
  })

  it('discards reactive draft state when the open character changes', async () => {
    const characterId = ref<number | undefined>(7)
    const mailbox = compositionMailbox()
    let composition!: ReturnType<typeof useMailComposition>
    vi.stubGlobal('useConfirmDialog', () => ({ openConfirmDialog: vi.fn() }))
    vi.stubGlobal('useToast', () => ({ dismissToast: vi.fn(), showToast: vi.fn(() => 1) }))
    const Root = defineComponent({
      setup() {
        composition = useMailComposition({
          apiClient: createApiClient('http://localhost'),
          authenticated: computed(() => false),
          characterId: computed(() => characterId.value),
          mailbox,
        })
        return () => h('div')
      },
    })
    const { wrapper } = mountWithQueryPlugins(Root)

    composition.openNew()
    composition.subject.value = 'Private draft'
    composition.body.value = 'Private body'
    composition.recipients.value = [{ id: 44, name: null, type: 'character' }]
    characterId.value = 8
    await nextTick()

    expect(composition.open.value).toBe(false)
    expect(composition.subject.value).toBe('')
    expect(composition.body.value).toBe('')
    expect(composition.recipients.value).toEqual([])
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('adds an exact local mailing list without enabling a protected lookup', () => {
    const mailbox = compositionMailbox([{ mailingListId: 77, name: 'Alliance Logistics' }])
    let composition!: ReturnType<typeof useMailComposition>
    vi.stubGlobal('useConfirmDialog', () => ({ openConfirmDialog: vi.fn() }))
    vi.stubGlobal('useToast', () => ({ dismissToast: vi.fn(), showToast: vi.fn(() => 1) }))
    const Root = defineComponent({
      setup() {
        composition = useMailComposition({
          apiClient: createApiClient('http://localhost'),
          authenticated: computed(() => false),
          characterId: computed(() => 7),
          mailbox,
        })
        return () => h('div')
      },
    })
    const { wrapper } = mountWithQueryPlugins(Root)

    composition.recipientInput.value = 'Alliance Logistics'
    composition.resolveRecipient()

    expect(composition.recipients.value).toEqual([
      { id: 77, name: 'Alliance Logistics', type: 'mailing_list' },
    ])
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('does not recover a recipient charge while the draft is invalid', async () => {
    const fetchMock = vi.fn()
    let composition!: ReturnType<typeof useMailComposition>
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('useConfirmDialog', () => ({ openConfirmDialog: vi.fn() }))
    vi.stubGlobal('useToast', () => ({ dismissToast: vi.fn(), showToast: vi.fn(() => 1) }))
    const Root = defineComponent({
      setup() {
        composition = useMailComposition({
          apiClient: createApiClient('http://localhost'),
          authenticated: computed(() => false),
          characterId: computed(() => 7),
          mailbox: compositionMailbox(),
        })
        return () => h('div')
      },
    })
    const { wrapper } = mountWithQueryPlugins(Root)

    composition.recipients.value = [{ id: 44, name: 'Wingmate', type: 'character' }]
    composition.subject.value = 'x'.repeat(MAIL_SUBJECT_LIMIT + 1)
    composition.chargeRecoveryAvailable.value = true
    await composition.recoverCharge()

    expect(composition.sendDisabledReason.value).toContain('Subject exceeds')
    expect(composition.subjectRemaining.value).toBe(-1)
    expect(fetchMock).not.toHaveBeenCalled()
    composition.subject.value = ''
    composition.body.value = 'x'.repeat(MAIL_BODY_LIMIT + 1)
    expect(composition.sendDisabledReason.value).toContain('Body exceeds')
    expect(composition.bodyRemaining.value).toBe(-1)
    composition.body.value = ''
    composition.recipients.value = Array.from({ length: MAIL_RECIPIENT_LIMIT + 1 }, (_, id) => ({
      id: id + 1,
      name: `Pilot ${id + 1}`,
      type: 'character' as const,
    }))
    expect(composition.sendDisabledReason.value).toContain('at most 50')
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('opens seeded drafts and rejects a reply to an unresolved sender', () => {
    const detail = mailDetail({
      recipients: [
        { id: 7, name: 'Reading Pilot', type: 'character' },
        { id: 44, name: 'Wingmate', type: 'character' },
      ],
    })
    const harness = mountCompositionHarness({ detail })

    harness.composition.openReply()
    expect(harness.composition.mode.value).toBe('reply')
    expect(harness.composition.recipients.value).toEqual([
      { id: 91, name: 'Operations Control', type: 'corporation' },
    ])

    harness.composition.openReplyAll()
    expect(harness.composition.mode.value).toBe('reply-all')
    expect(harness.composition.recipients.value).toContainEqual({
      id: 44,
      name: 'Wingmate',
      type: 'character',
    })

    harness.composition.openForward()
    expect(harness.composition.mode.value).toBe('forward')
    expect(harness.composition.recipients.value).toEqual([])

    harness.mailbox.detailQuery.data.value = mailDetail({
      sender: { id: 91, name: null, type: 'unknown' },
    })
    harness.composition.openReply()
    expect(harness.composition.replyUnavailableReason.value).toContain('sender type')
    expect(harness.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Reply unavailable' }),
    )
    harness.wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('manages recipients, local suggestions, limits, and discard confirmation', () => {
    const harness = mountCompositionHarness({
      mailingLists: [{ mailingListId: 77, name: 'Alliance Logistics' }],
    })
    const character = { id: 44, name: 'Wingmate', type: 'character' as const }

    harness.composition.openNew()
    harness.composition.resolveRecipient()
    expect(harness.composition.feedback.value).toBe('Enter a recipient name.')

    harness.composition.recipientInput.value = 'alliance'
    expect(harness.composition.recipientSuggestions.value).toEqual([
      { id: 77, name: 'Alliance Logistics', type: 'mailing_list' },
    ])
    harness.composition.recipientInput.value = 'Alliance Logistics'
    harness.composition.resolveRecipient()
    harness.composition.addRecipient(character)
    harness.composition.addRecipient(character)
    expect(harness.composition.recipients.value).toHaveLength(2)
    harness.composition.removeRecipient(character)
    expect(harness.composition.recipients.value).toHaveLength(1)

    harness.composition.recipients.value = Array.from(
      { length: MAIL_RECIPIENT_LIMIT },
      (_, id) => ({
        id: id + 1,
        name: `Pilot ${id + 1}`,
        type: 'character' as const,
      }),
    )
    harness.composition.addRecipient({ id: 100, name: 'Overflow', type: 'character' })
    expect(harness.composition.feedback.value).toContain('at most 50')

    harness.composition.requestClose()
    const confirmation = lastConfirmation(harness.openConfirmDialog)
    confirmation.onClose?.()
    expect(harness.composition.open.value).toBe(true)
    confirmation.onConfirm()
    expect(harness.composition.open.value).toBe(false)

    harness.composition.openNew()
    harness.composition.requestClose()
    expect(harness.composition.open.value).toBe(false)
    harness.wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('keeps the draft open and processes the outcome while sending', async () => {
    let releaseSend!: () => void
    const heldSend = new Promise<void>((release) => (releaseSend = release))
    queryServer.use(
      http.post('http://localhost/api/me/characters/7/mail', async () => {
        await heldSend
        return HttpResponse.json({ characterId: 7, mailId: 9001 }, { status: 201 })
      }),
    )
    const harness = mountCompositionHarness()
    harness.composition.openNew()
    harness.composition.recipients.value = [
      { id: 91, name: 'Operations Control', type: 'corporation' },
    ]
    harness.composition.subject.value = 'Slow transmission'
    harness.composition.body.value = 'Message body'

    const send = harness.composition.send()
    await vi.waitFor(() => expect(harness.composition.sending.value).toBe(true))
    harness.composition.requestClose()

    expect(harness.composition.open.value).toBe(true)
    expect(harness.openConfirmDialog).not.toHaveBeenCalled()
    releaseSend()
    await send
    expect(harness.composition.open.value).toBe(false)
    expect(harness.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Mail sent' }))
    harness.wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('sends directly or after approving a calculated recipient charge', async () => {
    const sentBodies: unknown[] = []
    queryServer.use(
      http.post('http://localhost/api/me/characters/7/mail/cspa', () =>
        HttpResponse.json({ characterId: 7, cost: 125.2 }),
      ),
      http.post('http://localhost/api/me/characters/7/mail', async ({ request }) => {
        sentBodies.push(await request.json())
        return HttpResponse.json({ characterId: 7, mailId: 9001 }, { status: 201 })
      }),
    )
    const harness = mountCompositionHarness()
    harness.composition.recipients.value = [
      { id: 44, name: 'Wingmate', type: 'character' },
      { id: 91, name: 'Operations Control', type: 'corporation' },
    ]
    harness.composition.subject.value = 'Charged message'
    harness.composition.body.value = 'Message body'

    await harness.composition.send()
    const confirmation = lastConfirmation(harness.openConfirmDialog)
    expect(confirmation.description).toContain('126 ISK')
    expect(sentBodies).toEqual([])
    harness.composition.recipients.value = [{ id: 45, name: 'Late addition', type: 'character' }]
    harness.composition.subject.value = 'Edited after charge lookup'
    harness.composition.body.value = 'Edited body'
    await confirmation.onConfirm()

    expect(sentBodies).toEqual([
      {
        approvedCost: 126,
        body: 'Message body',
        recipients: [
          { id: 44, type: 'character' },
          { id: 91, type: 'corporation' },
        ],
        subject: 'Charged message',
      },
    ])
    expect(harness.composition.open.value).toBe(false)
    expect(harness.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Mail sent' }))

    harness.composition.openNew()
    harness.composition.recipients.value = [
      { id: 91, name: 'Operations Control', type: 'corporation' },
    ]
    await harness.composition.send()
    expect(sentBodies).toHaveLength(2)
    harness.wrapper.unmount()
    expect(harness.dismissToast).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('offers an explicit send when charge lookup needs authorization', async () => {
    const sentBodies: unknown[] = []
    queryServer.use(
      http.post('http://localhost/api/me/characters/7/mail/cspa', () =>
        HttpResponse.json(
          {
            authorizeUrl: 'http://localhost/auth/eve/reauthorize/7',
            code: 'EVE_SCOPE_REQUIRED',
            message: 'Authorize charge lookup.',
          },
          { status: 403 },
        ),
      ),
      http.post('http://localhost/api/me/characters/7/mail', async ({ request }) => {
        sentBodies.push(await request.json())
        return HttpResponse.json({ characterId: 7, mailId: 9001 }, { status: 201 })
      }),
    )
    const harness = mountCompositionHarness()
    harness.composition.recipients.value = [{ id: 44, name: 'Wingmate', type: 'character' }]

    await harness.composition.send()
    expect(harness.composition.feedback.value).toContain('could not be determined')
    expect(harness.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        actionHref: 'http://localhost/auth/eve/reauthorize/7',
        title: 'Mail charge authorization required',
      }),
    )
    const confirmation = lastConfirmation(harness.openConfirmDialog)
    await confirmation.onConfirm()
    expect(sentBodies[0]).toMatchObject({ approvedCost: 0 })
    harness.wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('preserves delivery uncertainty and exposes authorization and rejection outcomes', async () => {
    let response = {
      status: 502,
      body: {
        code: 'MAIL_DELIVERY_UNKNOWN',
        message: 'Inspect sent mail before sending again.',
      },
    }
    queryServer.use(
      http.post('http://localhost/api/me/characters/7/mail/cspa', () =>
        HttpResponse.json({ characterId: 7, cost: 0 }),
      ),
      http.post('http://localhost/api/me/characters/7/mail', () =>
        HttpResponse.json(response.body, { status: response.status }),
      ),
    )
    const harness = mountCompositionHarness()
    const corporation = { id: 91, name: 'Operations Control', type: 'corporation' as const }
    harness.composition.recipients.value = [corporation]

    await harness.composition.send()
    expect(harness.composition.sendDisabledReason.value).toContain('Check Sent mail')
    expect(harness.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Mail delivery unconfirmed' }),
    )

    harness.composition.openNew()
    harness.composition.recipients.value = [corporation]
    response = {
      status: 403,
      body: {
        code: 'EVE_REAUTH_REQUIRED',
        message: 'Authorize mail sending.',
        authorizeUrl: 'http://localhost/auth/eve/reauthorize/7',
      } as typeof response.body,
    }
    await harness.composition.send()
    expect(harness.composition.sendAuthorizationMessage.value).toBe('Authorize mail sending.')
    expect(harness.composition.sendAuthorizationUrl.value).toContain('/reauthorize/7')

    harness.composition.openNew()
    harness.composition.recipients.value = [{ id: 44, name: 'Wingmate', type: 'character' }]
    response = {
      status: 422,
      body: { code: 'MAIL_REJECTED', message: 'Recipient charge was refused.' },
    }
    await harness.composition.send()
    expect(harness.composition.chargeRecoveryAvailable.value).toBe(true)
    expect(harness.composition.feedback.value).toContain('message was refused')

    harness.composition.openNew()
    harness.composition.recipients.value = [corporation]
    response = {
      status: 502,
      body: { code: 'ESI_UNAVAILABLE', message: 'Mail provider unavailable.' },
    }
    await harness.composition.send()
    expect(harness.composition.feedback.value).toBe('Mail provider unavailable.')
    harness.wrapper.unmount()
    expect(harness.dismissToast).toHaveBeenCalledWith(1)
    vi.unstubAllGlobals()
  })

  it('recovers zero and positive recipient charges and reports lookup failures', async () => {
    let chargeStatus = 200
    let charge = 0
    queryServer.use(
      http.post('http://localhost/api/me/characters/7/mail/cspa', () =>
        chargeStatus === 200
          ? HttpResponse.json({ characterId: 7, cost: charge })
          : HttpResponse.json(
              { code: 'ESI_UNAVAILABLE', message: 'Unavailable.' },
              { status: 502 },
            ),
      ),
      http.post('http://localhost/api/me/characters/7/mail', () =>
        HttpResponse.json({ characterId: 7, mailId: 9001 }, { status: 201 }),
      ),
    )
    const harness = mountCompositionHarness()
    const character = { id: 44, name: 'Wingmate', type: 'character' as const }
    harness.composition.recipients.value = [{ id: 91, name: 'Corp', type: 'corporation' }]
    await harness.composition.recoverCharge()
    expect(harness.composition.feedback.value).toContain('Only character recipients')

    harness.composition.recipients.value = [character]
    await harness.composition.recoverCharge()
    expect(harness.composition.feedback.value).toContain('No recipient charge applies')

    charge = 10.1
    await harness.composition.recoverCharge()
    const confirmation = lastConfirmation(harness.openConfirmDialog)
    expect(confirmation.description).toContain('11 ISK')
    await confirmation.onConfirm()

    harness.composition.recipients.value = [character]
    chargeStatus = 502
    await harness.composition.recoverCharge()
    expect(harness.composition.feedback.value).toContain('could not be determined')
    harness.wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('keeps all published limits and protected lookup gates explicit', () => {
    const composition = readWorkspaceFile('app/composables/useMailComposition.ts')

    expect(MAIL_RECIPIENT_LIMIT).toBe(50)
    expect(MAIL_SUBJECT_LIMIT).toBe(1_000)
    expect(MAIL_BODY_LIMIT).toBe(10_000)
    expect(MAIL_RECIPIENT_SEARCH_MIN_LENGTH).toBe(3)
    expect(composition).toContain('canRunProtectedQuery(import.meta.client')
    expect(composition).toContain('searchQuery.value.length >= MAIL_RECIPIENT_SEARCH_MIN_LENGTH')
  })

  it('uses shared dialog, confirmation, and toast infrastructure without invalidating mail', () => {
    const composition = readWorkspaceFile('app/composables/useMailComposition.ts')
    const dialog = readWorkspaceFile('app/components/mail/MailComposeDialog.vue')

    expect(dialog).toContain('<UiDialog')
    expect(composition).toContain('openConfirmDialog({')
    expect(composition).toContain('duration: Number.POSITIVE_INFINITY')
    expect(composition).toContain('!preserveToastOnDispose')
    expect(composition).not.toMatch(/invalidateQueries|refetchQueries/)
  })
})

function mailDetail(overrides: Partial<MailDetail> = {}): MailDetail {
  return {
    body: 'Plain message body',
    cachedUntil: '2026-08-29T12:00:30.000Z',
    characterId: 7,
    isRead: false,
    labelIds: [1],
    mailId: 120,
    quota: {},
    recipients: [{ id: 7, type: 'character', name: 'Reading Pilot' }],
    sender: { id: 91, type: 'corporation', name: 'Operations Control' },
    sentAt: '2026-08-29T12:00:00.000Z',
    source: 'esi',
    stale: false,
    subject: 'Priority operations update',
    ...overrides,
  }
}

function compositionMailbox(
  mailingLists: Array<{ mailingListId: number; name: string }> = [],
  detail?: MailDetail,
): Parameters<typeof useMailComposition>[0]['mailbox'] {
  return {
    detailQuery: { data: ref(detail) },
    mailingLists: ref(mailingLists),
    selectedMailId: ref<number | null>(detail?.mailId ?? null),
  } as unknown as Parameters<typeof useMailComposition>[0]['mailbox']
}

function mountCompositionHarness({
  detail,
  mailingLists = [],
}: {
  detail?: MailDetail
  mailingLists?: Array<{ mailingListId: number; name: string }>
} = {}) {
  const mailbox = compositionMailbox(mailingLists, detail)
  const openConfirmDialog = vi.fn()
  const dismissToast = vi.fn()
  const showToast = vi.fn(() => 1)
  let composition!: ReturnType<typeof useMailComposition>
  vi.stubGlobal('useConfirmDialog', () => ({ openConfirmDialog }))
  vi.stubGlobal('useToast', () => ({ dismissToast, showToast }))
  const Root = defineComponent({
    setup() {
      composition = useMailComposition({
        apiClient: createApiClient('http://localhost'),
        authenticated: computed(() => true),
        characterId: computed(() => 7),
        mailbox,
      })
      return () => h('div')
    },
  })
  const { wrapper } = mountWithQueryPlugins(Root)
  return { composition, dismissToast, mailbox, openConfirmDialog, showToast, wrapper }
}

function lastConfirmation(openConfirmDialog: ReturnType<typeof vi.fn>) {
  const value = openConfirmDialog.mock.calls.at(-1)?.[0] as
    | {
        description: string
        onClose?: () => void
        onConfirm: () => void | Promise<void>
      }
    | undefined
  expect(value).toBeDefined()
  return value!
}
