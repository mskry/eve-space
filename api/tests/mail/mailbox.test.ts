import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class EsiTransportError extends Error {
    constructor(
      cause: unknown,
      readonly status?: number,
    ) {
      super('ESI transport request failed', { cause })
      this.name = 'EsiTransportError'
    }
  }

  return {
    EsiTransportError,
    createMailClient: vi.fn(),
    createEsiTransport: vi.fn(),
    getCharacter: vi.fn(),
    executeCharacterMutation: vi.fn(),
    resolveUniverseNames: vi.fn(),
    listHeaders: vi.fn(),
    getMail: vi.fn(),
    listLabels: vi.fn(),
    listMailingLists: vi.fn(),
    send: vi.fn(),
    createLabel: vi.fn(),
    update: vi.fn(),
    deleteMail: vi.fn(),
    deleteLabel: vi.fn(),
  }
})

vi.mock('@evespace/esi-client/domains/mail', () => ({
  createMailClient: mocks.createMailClient,
}))

vi.mock('../../src/esi-resilience/resilience.js', () => ({
  getEsiResilienceLayer: () => ({
    getCharacter: mocks.getCharacter,
    executeCharacterMutation: mocks.executeCharacterMutation,
  }),
}))

vi.mock('../../src/esi-resilience/transport.js', () => ({
  EsiTransportError: mocks.EsiTransportError,
  createEsiTransport: mocks.createEsiTransport,
}))

vi.mock('../../src/universe/names.js', () => ({
  resolveUniverseNames: mocks.resolveUniverseNames,
}))

import { EsiQuotaError } from '../../src/esi-resilience/cooldowns.js'
import {
  createMailLabel,
  deleteMail,
  deleteMailLabel,
  getMailDetail,
  getMailLabels,
  getMailingLists,
  listMailHeaders,
  MailAuthorizationError,
  MailDeliveryUnknownError,
  MailMutationRejectedError,
  MailNotFoundError,
  MailRejectedError,
  MailUnavailableError,
  sendMail,
  updateMail,
} from '../../src/mail/mailbox.js'
import { ScopeRequiredError, TokenRefreshUnavailableError } from '../../src/auth/tokens.js'

const characterId = 90_000_001
const authority = { accessToken: 'access-token', principal: 'character-90000001' }
const revalidation = { ifNoneMatch: 'mail-etag', ifModifiedSince: 'Wed, 26 Aug 2026 12:00:00 GMT' }
const outerMetadata = {
  cachedUntil: '2026-08-27T12:00:30.000Z',
  validatedAt: '2026-08-27T12:00:00.000Z',
  source: 'esi' as const,
  stale: false,
  quota: { group: 'char-social', remaining: 598 },
}
const sdkMetadata = {
  status: 200,
  headers: { etag: 'mail-etag', expires: 'Thu, 27 Aug 2026 12:00:30 GMT' },
}

beforeEach(() => {
  mocks.createEsiTransport.mockImplementation((operation, principal) => `${operation}:${principal}`)
  mocks.createMailClient.mockReturnValue({
    withMetadata: () => ({
      listHeaders: mocks.listHeaders,
      get: mocks.getMail,
      listLabels: mocks.listLabels,
      listMailingLists: mocks.listMailingLists,
      send: mocks.send,
      createLabel: mocks.createLabel,
      update: mocks.update,
      deleteMail: mocks.deleteMail,
      deleteLabel: mocks.deleteLabel,
    }),
  })
  mocks.getCharacter.mockImplementation(async (resource) => {
    const loaded = await resource.load(authority, revalidation)
    return { data: loaded.data, ...outerMetadata }
  })
  mocks.executeCharacterMutation.mockImplementation(async (mutation) => mutation.load(authority))
  mocks.resolveUniverseNames.mockResolvedValue(new Map())
  mocks.listHeaders.mockResolvedValue(response([]))
  mocks.getMail.mockResolvedValue(response({}))
  mocks.listLabels.mockResolvedValue(response({}))
  mocks.listMailingLists.mockResolvedValue(response([]))
  mocks.send.mockResolvedValue(response(7001, 201))
  mocks.createLabel.mockResolvedValue(response(31, 201))
  mocks.update.mockResolvedValue(response(undefined, 204))
  mocks.deleteMail.mockResolvedValue(response(undefined, 204))
  mocks.deleteLabel.mockResolvedValue(response(undefined, 204))
})

describe('mail reads', () => {
  test('maps a populated header page in ESI order and enriches all party kinds', async () => {
    mocks.listHeaders.mockResolvedValue(
      response([
        header(500, {
          from: 100,
          recipients: [
            { recipient_id: 200, recipient_type: 'character' },
            { recipient_id: 300, recipient_type: 'corporation' },
            { recipient_id: 400, recipient_type: 'alliance' },
            { recipient_id: 600, recipient_type: 'mailing_list' },
          ],
        }),
        header(499, {
          from: 100,
          recipients: [{ recipient_id: 200, recipient_type: 'character' }],
        }),
      ]),
    )
    mocks.resolveUniverseNames.mockResolvedValue(
      new Map([
        [100, { id: 100, name: 'Sender', category: 'character' }],
        [200, { id: 200, name: 'Recipient', category: 'character' }],
        [300, { id: 300, name: 'Corporation', category: 'corporation' }],
        [400, { id: 400, name: 'Alliance', category: 'alliance' }],
      ]),
    )
    mocks.listMailingLists.mockResolvedValue(
      response([{ mailing_list_id: 600, name: 'Subscribed List' }]),
    )

    const result = await listMailHeaders(characterId)

    expect(result).toEqual({
      characterId,
      messages: [
        {
          mailId: 500,
          sender: { id: 100, type: 'character', name: 'Sender' },
          recipients: [
            { id: 200, type: 'character', name: 'Recipient' },
            { id: 300, type: 'corporation', name: 'Corporation' },
            { id: 400, type: 'alliance', name: 'Alliance' },
            { id: 600, type: 'mailing_list', name: 'Subscribed List' },
          ],
          subject: 'Subject 500',
          sentAt: '2026-08-27T10:00:00Z',
          labelIds: [1, 2],
          isRead: false,
        },
        expect.objectContaining({ mailId: 499 }),
      ],
      nextLastMailId: null,
      ...outerMetadata,
    })
    expect(mocks.resolveUniverseNames).toHaveBeenCalledWith([100, 200, 300, 400])
  })

  test('maps every absent optional header field to null or an empty collection', async () => {
    mocks.listHeaders.mockResolvedValue(response([{ mail_id: 15 }]))

    await expect(listMailHeaders(characterId)).resolves.toMatchObject({
      messages: [
        {
          mailId: 15,
          sender: null,
          recipients: [],
          subject: null,
          sentAt: null,
          labelIds: [],
          isRead: null,
        },
      ],
    })
    expect(mocks.resolveUniverseNames).not.toHaveBeenCalled()
    expect(mocks.listMailingLists).not.toHaveBeenCalled()
  })

  test('rejects an entire page when any header lacks its essential mail ID', async () => {
    mocks.listHeaders.mockResolvedValue(
      response([header(20), { subject: 'malformed' }, header(18)]),
    )

    await expect(listMailHeaders(characterId)).rejects.toBeInstanceOf(MailUnavailableError)
    expect(mocks.resolveUniverseNames).not.toHaveBeenCalled()
  })

  test('uses only the final ID of an exactly full page as the next cursor', async () => {
    mocks.listHeaders.mockResolvedValue(
      response(Array.from({ length: 50 }, (_, index) => ({ mail_id: 1000 - index }))),
    )

    await expect(listMailHeaders(characterId)).resolves.toMatchObject({ nextLastMailId: 951 })

    mocks.listHeaders.mockResolvedValueOnce(
      response(Array.from({ length: 49 }, (_, index) => ({ mail_id: 900 - index }))),
    )
    await expect(listMailHeaders(characterId)).resolves.toMatchObject({ nextLastMailId: null })

    mocks.listHeaders.mockResolvedValueOnce(response([]))
    await expect(listMailHeaders(characterId)).resolves.toMatchObject({ nextLastMailId: null })
  })

  test('normalizes label filters for both identity and SDK options and propagates revalidation', async () => {
    await listMailHeaders(characterId, { labels: [9, 3, 9, 5], lastMailId: 800 })

    expect(mocks.getCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'mail-headers',
        inputs: { characterId, labels: [3, 5, 9], lastMailId: 800 },
      }),
    )
    expect(mocks.listHeaders).toHaveBeenCalledWith(characterId, {
      labels: [3, 5, 9],
      lastMailId: 800,
      ...revalidation,
    })

    await listMailHeaders(characterId, { labels: [] })
    expect(mocks.getCharacter).toHaveBeenLastCalledWith(
      expect.objectContaining({
        inputs: { characterId, labels: null, lastMailId: null },
      }),
    )
    expect(mocks.listHeaders).toHaveBeenLastCalledWith(characterId, revalidation)
  })

  test('normalizes detail bodies and preserves outer cache metadata', async () => {
    mocks.getMail.mockResolvedValue(
      response({
        body: String.raw`u'<p>First &amp; second<br><br>Fly \uace0</p>'`,
        from: 100,
        labels: [4],
        read: true,
        recipients: [{ recipient_id: 200, recipient_type: 'character' }],
        subject: 'Detail',
        timestamp: '2026-08-27T11:00:00Z',
      }),
    )
    mocks.resolveUniverseNames.mockResolvedValue(
      new Map([
        [100, { id: 100, name: 'Sender Corp', category: 'corporation' }],
        [200, { id: 200, name: 'Recipient', category: 'character' }],
      ]),
    )

    await expect(getMailDetail(characterId, 44)).resolves.toEqual({
      characterId,
      mailId: 44,
      sender: { id: 100, type: 'corporation', name: 'Sender Corp' },
      recipients: [{ id: 200, type: 'character', name: 'Recipient' }],
      subject: 'Detail',
      sentAt: '2026-08-27T11:00:00Z',
      labelIds: [4],
      isRead: true,
      body: 'First & second\n\nFly 고',
      ...outerMetadata,
    })
    expect(mocks.getMail).toHaveBeenCalledWith(characterId, 44, revalidation)
  })

  test('maps null and absent optional detail fields without inventing message state', async () => {
    mocks.getMail.mockResolvedValue(response({ body: null }))

    await expect(getMailDetail(characterId, 45)).resolves.toMatchObject({
      characterId,
      mailId: 45,
      sender: null,
      recipients: [],
      subject: null,
      sentAt: null,
      labelIds: [],
      isRead: null,
      body: null,
    })
  })

  test('returns unresolved and category-mismatched parties without failing mail', async () => {
    mocks.listHeaders.mockResolvedValue(
      response([
        header(77, {
          from: 100,
          recipients: [
            { recipient_id: 200, recipient_type: 'character' },
            { recipient_id: 300, recipient_type: 'corporation' },
          ],
        }),
      ]),
    )
    mocks.resolveUniverseNames.mockResolvedValue(
      new Map([
        [100, { id: 100, name: 'Unsupported', category: 'faction' }],
        [200, { id: 200, name: 'Wrong category', category: 'corporation' }],
      ]),
    )

    await expect(listMailHeaders(characterId)).resolves.toMatchObject({
      messages: [
        {
          sender: { id: 100, type: 'unknown', name: null },
          recipients: [
            { id: 200, type: 'character', name: null },
            { id: 300, type: 'corporation', name: null },
          ],
        },
      ],
    })
  })

  test('isolates Universe Names and mailing-list lookup failures', async () => {
    mocks.listHeaders.mockResolvedValue(
      response([
        header(77, {
          from: 100,
          recipients: [{ recipient_id: 600, recipient_type: 'mailing_list' }],
        }),
      ]),
    )
    mocks.resolveUniverseNames.mockRejectedValue(new Error('names unavailable'))
    mocks.getCharacter.mockImplementation(async (resource) => {
      if (resource.operation === 'mail-lists') throw new Error('lists unavailable')
      const loaded = await resource.load(authority, revalidation)
      return { data: loaded.data, ...outerMetadata }
    })

    await expect(listMailHeaders(characterId)).resolves.toMatchObject({
      messages: [
        {
          sender: { id: 100, type: 'unknown', name: null },
          recipients: [{ id: 600, type: 'mailing_list', name: null }],
        },
      ],
    })
  })

  test('maps labels, mailing lists, optional fields, metadata, and operation transports', async () => {
    mocks.listLabels.mockResolvedValue(
      response({
        labels: [{ label_id: 2, name: 'Inbox', color: '#ffffff', unread_count: 5 }, {}],
        total_unread_count: 7,
      }),
    )
    mocks.listMailingLists.mockResolvedValue(response([{ mailing_list_id: 99, name: 'A List' }]))

    await expect(getMailLabels(characterId)).resolves.toEqual({
      characterId,
      labels: [
        { labelId: 2, name: 'Inbox', color: '#ffffff', unreadCount: 5 },
        { labelId: null, name: null, color: null, unreadCount: null },
      ],
      totalUnreadCount: 7,
      ...outerMetadata,
    })
    await expect(getMailingLists(characterId)).resolves.toEqual({
      characterId,
      mailingLists: [{ mailingListId: 99, name: 'A List' }],
      ...outerMetadata,
    })
    expect(mocks.listLabels).toHaveBeenCalledWith(characterId, revalidation)
    expect(mocks.listMailingLists).toHaveBeenCalledWith(characterId, revalidation)
    expect(mocks.createEsiTransport).toHaveBeenCalledWith('mail-labels', authority.principal)
    expect(mocks.createEsiTransport).toHaveBeenCalledWith('mail-lists', authority.principal)
    expect(mocks.createMailClient).toHaveBeenCalledWith(
      expect.objectContaining({ token: authority.accessToken }),
    )

    mocks.listLabels.mockResolvedValueOnce(response({}))
    mocks.listMailingLists.mockResolvedValueOnce(response([]))
    await expect(getMailLabels(characterId)).resolves.toMatchObject({
      labels: [],
      totalUnreadCount: null,
    })
    await expect(getMailingLists(characterId)).resolves.toMatchObject({ mailingLists: [] })
  })

  test('propagates SDK response metadata from every read loader', async () => {
    const loadedMetadata = new Map<string, unknown>()
    mocks.getCharacter.mockImplementation(async (resource) => {
      const loaded = await resource.load(authority, revalidation)
      loadedMetadata.set(resource.operation, loaded.meta)
      return { data: loaded.data, ...outerMetadata }
    })

    await listMailHeaders(characterId)
    await getMailDetail(characterId, 1)
    await getMailLabels(characterId)
    await getMailingLists(characterId)

    expect(loadedMetadata).toEqual(
      new Map([
        ['mail-headers', sdkMetadata],
        ['mail-message', sdkMetadata],
        ['mail-labels', sdkMetadata],
        ['mail-lists', sdkMetadata],
      ]),
    )
  })
})

describe('mail mutations', () => {
  test('sends exact SDK payloads with an approved-cost default and returns selected identity', async () => {
    const input = {
      recipients: [
        { id: 100, type: 'character' as const },
        { id: 200, type: 'mailing_list' as const },
      ],
      subject: 'Subject',
      body: 'Body',
    }

    await expect(sendMail(characterId, input)).resolves.toEqual({ characterId, mailId: 7001 })
    expect(mocks.send).toHaveBeenCalledWith(characterId, {
      body: {
        approved_cost: 0,
        body: 'Body',
        recipients: [
          { recipient_id: 100, recipient_type: 'character' },
          { recipient_id: 200, recipient_type: 'mailing_list' },
        ],
        subject: 'Subject',
      },
    })
    expect(mocks.executeCharacterMutation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'mail-send', characterId }),
    )
    expect(mocks.createEsiTransport).toHaveBeenCalledWith('mail-send', authority.principal)

    await sendMail(characterId, { ...input, approvedCost: 25 })
    expect(mocks.send).toHaveBeenLastCalledWith(
      characterId,
      expect.objectContaining({ body: expect.objectContaining({ approved_cost: 25 }) }),
    )
  })

  test('creates labels once with exact optional payloads and returns selected identity', async () => {
    await expect(
      createMailLabel(characterId, { name: 'Important', color: '#fe0000' }),
    ).resolves.toEqual({ characterId, labelId: 31 })
    expect(mocks.createLabel).toHaveBeenCalledWith(characterId, {
      body: { name: 'Important', color: '#fe0000' },
    })

    await createMailLabel(characterId, { name: 'No color' })
    expect(mocks.createLabel).toHaveBeenLastCalledWith(characterId, {
      body: { name: 'No color' },
    })
  })

  test('updates desired read state and complete label replacement with exact payloads', async () => {
    await expect(updateMail(characterId, 51, { read: false, labels: [4, 2] })).resolves.toEqual({
      characterId,
      mailId: 51,
    })
    expect(mocks.update).toHaveBeenCalledWith(characterId, 51, {
      body: { labels: [4, 2], read: false },
    })
    expect(mocks.executeCharacterMutation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'mail-update', characterId }),
    )
  })

  test('deletes mail and labels through their registered mutation operations', async () => {
    await expect(deleteMail(characterId, 51)).resolves.toEqual({ characterId, mailId: 51 })
    await expect(deleteMailLabel(characterId, 8)).resolves.toEqual({ characterId, labelId: 8 })

    expect(mocks.deleteMail).toHaveBeenCalledWith(characterId, 51)
    expect(mocks.deleteLabel).toHaveBeenCalledWith(characterId, 8)
    expect(mocks.executeCharacterMutation.mock.calls.map(([value]) => value.operation)).toEqual([
      'mail-delete',
      'mail-delete-label',
    ])
  })

  test('does not add a service retry for ambiguous sends or label creation', async () => {
    mocks.send.mockRejectedValueOnce(new mocks.EsiTransportError(new Error('socket closed')))

    await expect(
      sendMail(characterId, {
        recipients: [{ id: 100, type: 'character' }],
        subject: 'Subject',
        body: 'Body',
      }),
    ).rejects.toBeInstanceOf(MailDeliveryUnknownError)
    expect(mocks.executeCharacterMutation).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledTimes(1)

    mocks.executeCharacterMutation.mockClear()
    mocks.createLabel.mockRejectedValueOnce(new mocks.EsiTransportError(new Error('socket closed')))
    await expect(createMailLabel(characterId, { name: 'One attempt' })).rejects.toBeInstanceOf(
      MailUnavailableError,
    )
    expect(mocks.executeCharacterMutation).toHaveBeenCalledTimes(1)
    expect(mocks.createLabel).toHaveBeenCalledTimes(1)
  })

  test('treats provider 404 from either delete as converged success', async () => {
    mocks.executeCharacterMutation
      .mockRejectedValueOnce(providerError(404, 'mail content'))
      .mockRejectedValueOnce(providerError(404, 'label content'))

    await expect(deleteMail(characterId, 51)).resolves.toEqual({ characterId, mailId: 51 })
    await expect(deleteMailLabel(characterId, 8)).resolves.toEqual({ characterId, labelId: 8 })
  })

  test('propagates SDK metadata to the mutation executor without exposing it in results', async () => {
    const loadedMetadata = new Map<string, unknown>()
    mocks.executeCharacterMutation.mockImplementation(async (mutation) => {
      const loaded = await mutation.load(authority)
      loadedMetadata.set(mutation.operation, loaded.meta)
      return loaded
    })

    await sendMail(characterId, {
      recipients: [{ id: 100, type: 'character' }],
      subject: 'Subject',
      body: 'Body',
    })
    await createMailLabel(characterId, { name: 'Label' })
    await updateMail(characterId, 2, { read: true })
    await deleteMail(characterId, 2)
    await deleteMailLabel(characterId, 3)

    expect(loadedMetadata).toEqual(
      new Map([
        ['mail-send', { ...sdkMetadata, status: 201 }],
        ['mail-create-label', { ...sdkMetadata, status: 201 }],
        ['mail-update', { ...sdkMetadata, status: 204 }],
        ['mail-delete', { ...sdkMetadata, status: 204 }],
        ['mail-delete-label', { ...sdkMetadata, status: 204 }],
      ]),
    )
  })
})

describe('safe mail errors', () => {
  test.each([
    new ScopeRequiredError('esi-mail.read_mail.v1'),
    new TokenRefreshUnavailableError(),
    new EsiQuotaError(15),
  ])('preserves shared service error %s unchanged', async (sharedError) => {
    mocks.getCharacter.mockRejectedValueOnce(sharedError)

    await expect(listMailHeaders(characterId)).rejects.toBe(sharedError)
  })

  test.each([401, 403] as const)(
    'maps status %i to a safe status-only authorization error',
    async (status) => {
      mocks.getCharacter.mockRejectedValueOnce(
        providerError(status, 'secret provider authorization'),
      )

      const error = await caught(listMailHeaders(characterId))

      expect(error).toEqual(new MailAuthorizationError(status))
      expect(error).not.toHaveProperty('body')
      expect(error).not.toHaveProperty('cause')
      expect(JSON.stringify(error)).not.toContain('secret')
    },
  )

  test('maps only detail 404 to safe mail-not-found', async () => {
    mocks.getCharacter.mockRejectedValueOnce(providerError(404, 'raw missing-mail details'))
    await expect(getMailDetail(characterId, 99)).rejects.toEqual(new MailNotFoundError())

    mocks.getCharacter.mockRejectedValueOnce(providerError(404, 'raw page details'))
    await expect(listMailHeaders(characterId)).rejects.toEqual(new MailUnavailableError())
  })

  test.each([
    ['transport', new mocks.EsiTransportError(new Error('secret socket cause'))],
    ['parse', { code: 'ESI_RESPONSE_PARSE_ERROR', status: 201, body: 'secret body' }],
    ['validation', { code: 'ESI_RESPONSE_VALIDATION_ERROR', body: 'secret body' }],
    [
      'revision invalidation',
      Object.assign(new Error('safe invalidation failure'), {
        name: 'EsiResourceRevisionUnavailableError',
      }),
    ],
  ])(
    'maps ambiguous send %s failures without retaining provider content',
    async (_kind, provider) => {
      mocks.executeCharacterMutation.mockRejectedValueOnce(provider)

      const error = await caught(
        sendMail(characterId, {
          recipients: [{ id: 100, type: 'character' }],
          subject: 'private subject',
          body: 'private body',
        }),
      )

      expect(error).toEqual(new MailDeliveryUnknownError())
      expect(error).not.toHaveProperty('body')
      expect(error).not.toHaveProperty('cause')
      expect(JSON.stringify(error)).not.toMatch(/secret|private/)
    },
  )

  test('maps definitive non-auth send 4xx to a sanitized rejection', async () => {
    const provider = providerError(422, 'recipient and private body rejected')
    mocks.executeCharacterMutation.mockRejectedValueOnce(provider)

    const error = await caught(
      sendMail(characterId, {
        recipients: [{ id: 100, type: 'character' }],
        subject: 'private subject',
        body: 'private body',
      }),
    )

    expect(error).toEqual(new MailRejectedError())
    expect(error).not.toBe(provider)
    expect(error).not.toHaveProperty('body')
    expect(error).not.toHaveProperty('cause')
  })

  test('maps definitive organize 4xx and all other failures to sanitized service errors', async () => {
    mocks.executeCharacterMutation.mockRejectedValueOnce(providerError(409, 'raw label conflict'))
    await expect(createMailLabel(characterId, { name: 'Label' })).rejects.toEqual(
      new MailMutationRejectedError(),
    )

    mocks.executeCharacterMutation.mockRejectedValueOnce(providerError(503, 'raw outage'))
    await expect(updateMail(characterId, 1, { read: true })).rejects.toEqual(
      new MailUnavailableError(),
    )

    mocks.getCharacter.mockRejectedValueOnce(new Error('internal sensitive details'))
    await expect(getMailLabels(characterId)).rejects.toEqual(new MailUnavailableError())
  })
})

function response<Data>(data: Data, status = 200) {
  return { data, meta: { ...sdkMetadata, status } }
}

function header(
  mailId: number,
  overrides: Partial<{
    from: number
    is_read: boolean
    labels: number[]
    recipients: Array<{
      recipient_id: number
      recipient_type: 'alliance' | 'character' | 'corporation' | 'mailing_list'
    }>
    subject: string
    timestamp: string
  }> = {},
) {
  return {
    mail_id: mailId,
    from: mailId + 1000,
    is_read: false,
    labels: [1, 2],
    recipients: [],
    subject: `Subject ${mailId}`,
    timestamp: '2026-08-27T10:00:00Z',
    ...overrides,
  }
}

function providerError(status: number, content: string) {
  return {
    code: 'ESI_HTTP_ERROR',
    status,
    message: content,
    body: { error: content },
    cause: new Error(content),
  }
}

async function caught(promise: Promise<unknown>) {
  try {
    await promise
    throw new Error('Expected promise to reject')
  } catch (error) {
    return error as Error
  }
}
