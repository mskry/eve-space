import { EsiHttpError, EsiTransportError } from '@evespace/esi-client'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFeatureExecutionMock } from '../support/mock-feature-execution.js'

const mocks = vi.hoisted(() => ({
  executeMutationRepresentation: vi.fn(),
  executeRepresentation: vi.fn(),
  resolveUniverseIds: vi.fn(),
  resolveUniverseNames: vi.fn(),
}))

vi.mock('../../src/esi-gateway/feature-execution.js', () =>
  createFeatureExecutionMock(mocks.executeRepresentation, mocks.executeMutationRepresentation),
)
vi.mock('../../src/universe/names.js', () => ({
  resolveUniverseIds: mocks.resolveUniverseIds,
  resolveUniverseNames: mocks.resolveUniverseNames,
}))

import {
  calculateMailCspaCharge,
  createMailLabel,
  deleteMail,
  deleteMailLabel,
  getMailDetail,
  getMailLabels,
  getMailingLists,
  listMailHeaders,
  MailAuthorizationError,
  MailCspaRejectedError,
  MailDeliveryUnknownError,
  MailMutationRejectedError,
  MailNotFoundError,
  MailRejectedError,
  resolveMailRecipients,
  searchMailRecipients,
  sendMail,
  updateMail,
} from '../../src/mail/mailbox.js'

const characterId = 90_000_001
const subjectLifecycleId = '11111111-1111-4111-8111-111111111111'
const metadata = {
  cachedUntil: '2026-08-27T12:00:30.000Z',
  validatedAt: '2026-08-27T12:00:00.000Z',
  source: 'esi' as const,
  stale: false,
  quota: { group: 'char-social', remaining: 598 },
}

beforeEach(() => {
  mocks.resolveUniverseIds.mockResolvedValue([])
  mocks.resolveUniverseNames.mockResolvedValue(new Map())
  mocks.executeRepresentation.mockImplementation((definition) => {
    switch (definition.operation) {
      case 'mail-headers':
        return Promise.resolve(result({ messages: [], nextLastMailId: null }))
      case 'mail-message':
        return Promise.resolve(
          result({
            mailId: 1,
            sender: null,
            recipients: [],
            subject: null,
            sentAt: null,
            labelIds: [],
            isRead: null,
            body: null,
          }),
        )
      case 'mail-labels':
        return Promise.resolve(result({ labels: [], totalUnreadCount: null }))
      case 'mail-lists':
        return Promise.resolve(result([]))
      case 'character-search':
        return Promise.resolve(result([]))
      case 'character-cspa-charge':
        return Promise.resolve(result(0))
      default:
        throw new Error(`Unexpected callable ${definition.operation}`)
    }
  })
  mocks.executeMutationRepresentation.mockImplementation((definition, input) => {
    const request = input as { characterId: number; labelId?: number; mailId?: number }
    if (definition.operation === 'mail-send')
      return Promise.resolve({ characterId: request.characterId, mailId: 7001 })
    if (definition.operation === 'mail-create-label')
      return Promise.resolve({ characterId: request.characterId, labelId: 31 })
    if (definition.operation === 'mail-update')
      return Promise.resolve({ characterId: request.characterId, mailId: request.mailId! })
    if (definition.operation === 'mail-delete')
      return Promise.resolve({ characterId: request.characterId, mailId: request.mailId! })
    return Promise.resolve({ characterId: request.characterId, labelId: request.labelId! })
  })
})

describe('mail reads', () => {
  test('returns mapped header and detail callable results with metadata', async () => {
    mocks.executeRepresentation
      .mockResolvedValueOnce(
        result({
          messages: [
            {
              mailId: 500,
              sender: { id: 100, type: 'character', name: 'Sender' },
              recipients: [{ id: 200, type: 'character', name: 'Recipient' }],
              subject: 'Subject',
              sentAt: '2026-08-27T10:00:00Z',
              labelIds: [1],
              isRead: false,
            },
          ],
          nextLastMailId: null,
        }),
      )
      .mockResolvedValueOnce(
        result({
          mailId: 44,
          sender: null,
          recipients: [],
          subject: 'Detail',
          sentAt: '2026-08-27T11:00:00Z',
          labelIds: [4],
          isRead: true,
          body: 'First & second\n\nFly 고',
        }),
      )

    await expect(listMailHeaders(characterId, {}, subjectLifecycleId)).resolves.toMatchObject({
      characterId,
      messages: [{ mailId: 500, sender: { name: 'Sender' } }],
      ...metadata,
    })
    await expect(getMailDetail(characterId, 44, subjectLifecycleId)).resolves.toMatchObject({
      mailId: 44,
      body: 'First & second\n\nFly 고',
    })
  })

  test('normalizes filters before calling the boundary', async () => {
    await listMailHeaders(
      characterId,
      { labels: [9, 3, 9, 5], lastMailId: 800 },
      subjectLifecycleId,
    )
    expect(mocks.executeRepresentation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'mail-headers' }),
      { characterId, subjectLifecycleId, labels: [3, 5, 9], lastMailId: 800 },
      { subjectLifecycleId },
    )
  })

  test('preserves mapped labels, mailing lists, searches, and CSPA charges', async () => {
    mocks.executeRepresentation
      .mockResolvedValueOnce(
        result({
          labels: [{ labelId: 2, name: 'Inbox', color: '#ffffff', unreadCount: 5 }],
          totalUnreadCount: 7,
        }),
      )
      .mockResolvedValueOnce(result([{ mailingListId: 99, name: 'A List' }]))
      .mockResolvedValueOnce(result([{ id: 20, type: 'character', name: 'Character' }]))
      .mockResolvedValueOnce(result(12.5))

    await expect(getMailLabels(characterId, subjectLifecycleId)).resolves.toMatchObject({
      labels: [{ labelId: 2 }],
      totalUnreadCount: 7,
    })
    await expect(getMailingLists(characterId, subjectLifecycleId)).resolves.toMatchObject({
      mailingLists: [{ name: 'A List' }],
    })
    await expect(
      searchMailRecipients(characterId, 'pil', subjectLifecycleId),
    ).resolves.toMatchObject({ recipients: [{ id: 20 }] })
    await expect(calculateMailCspaCharge(characterId, [20], subjectLifecycleId)).resolves.toEqual({
      characterId,
      cost: 12.5,
    })
  })

  test('retains only addressable universe recipient categories', async () => {
    mocks.resolveUniverseIds.mockResolvedValue([
      { id: 1, category: 'alliance', name: 'Alliance' },
      { id: 2, category: 'character', name: 'Character' },
      { id: 4, category: 'faction', name: 'Faction' },
    ])
    await expect(resolveMailRecipients(['Alliance', 'Character'])).resolves.toEqual({
      recipients: [
        { id: 1, type: 'alliance', name: 'Alliance' },
        { id: 2, type: 'character', name: 'Character' },
      ],
    })
  })

  test('maps callable failures to safe read outcomes', async () => {
    mocks.executeRepresentation.mockRejectedValueOnce(providerError(403))
    await expect(listMailHeaders(characterId, {}, subjectLifecycleId)).rejects.toEqual(
      new MailAuthorizationError(403),
    )
    mocks.executeRepresentation.mockRejectedValueOnce(providerError(404))
    await expect(getMailDetail(characterId, 99, subjectLifecycleId)).rejects.toEqual(
      new MailNotFoundError(),
    )
  })
})

describe('mail mutations', () => {
  test('returns mapped mutation results and preserves callable inputs', async () => {
    await expect(
      sendMail(
        characterId,
        { recipients: [{ id: 100, type: 'character' }], subject: 'Subject', body: 'Body' },
        subjectLifecycleId,
      ),
    ).resolves.toEqual({ characterId, mailId: 7001 })
    await expect(
      createMailLabel(characterId, { name: 'Important', color: '#fe0000' }, subjectLifecycleId),
    ).resolves.toEqual({ characterId, labelId: 31 })
    await expect(
      updateMail(characterId, 51, { read: false, labels: [4, 2] }, subjectLifecycleId),
    ).resolves.toEqual({ characterId, mailId: 51 })
    await expect(deleteMail(characterId, 51, subjectLifecycleId)).resolves.toEqual({
      characterId,
      mailId: 51,
    })
    await expect(deleteMailLabel(characterId, 8, subjectLifecycleId)).resolves.toEqual({
      characterId,
      labelId: 8,
    })
    expect(
      mocks.executeMutationRepresentation.mock.calls.map(([definition]) => definition.operation),
    ).toEqual(['mail-send', 'mail-create-label', 'mail-update', 'mail-delete', 'mail-delete-label'])
  })

  test('maps ambiguous and definitive callable failures to sanitized mutation errors', async () => {
    mocks.executeMutationRepresentation.mockRejectedValueOnce(
      new EsiTransportError({
        operationId: 'PostCharactersCharacterIdMail',
        reason: 'network',
        phase: 'request',
        cause: new Error('socket closed'),
      }),
    )
    await expect(
      sendMail(
        characterId,
        { recipients: [{ id: 100, type: 'character' }], subject: 'Subject', body: 'Body' },
        subjectLifecycleId,
      ),
    ).rejects.toEqual(new MailDeliveryUnknownError())
    mocks.executeMutationRepresentation.mockRejectedValueOnce(providerError(422))
    await expect(
      sendMail(
        characterId,
        { recipients: [{ id: 100, type: 'character' }], subject: 'Subject', body: 'Body' },
        subjectLifecycleId,
      ),
    ).rejects.toEqual(new MailRejectedError())
    mocks.executeMutationRepresentation.mockRejectedValueOnce(providerError(409))
    await expect(
      createMailLabel(characterId, { name: 'Label' }, subjectLifecycleId),
    ).rejects.toEqual(new MailMutationRejectedError())
    mocks.executeRepresentation.mockRejectedValueOnce(providerError(400))
    await expect(calculateMailCspaCharge(characterId, [20], subjectLifecycleId)).rejects.toEqual(
      new MailCspaRejectedError(),
    )
  })
})

function result<Data>(data: Data) {
  return { data, ...metadata }
}

function providerError(status: number) {
  return new EsiHttpError({
    operationId: 'GetCharactersCharacterIdMail',
    status,
    responseBodyText: '{}',
    cause: new Error('provider failure'),
  })
}
