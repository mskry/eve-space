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
  quota: { group: 'char-social', remaining: 598 },
  source: 'esi' as const,
  stale: false,
  validatedAt: '2026-08-27T12:00:00.000Z',
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
            body: null,
            isRead: null,
            labelIds: [],
            mailId: 1,
            recipients: [],
            sender: null,
            sentAt: null,
            subject: null,
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
    if (definition.operation === 'mail-send') {
      return Promise.resolve({ characterId: request.characterId, mailId: 7001 })
    }
    if (definition.operation === 'mail-create-label') {
      return Promise.resolve({ characterId: request.characterId, labelId: 31 })
    }
    if (definition.operation === 'mail-update') {
      return Promise.resolve({ characterId: request.characterId, mailId: request.mailId! })
    }
    if (definition.operation === 'mail-delete') {
      return Promise.resolve({ characterId: request.characterId, mailId: request.mailId! })
    }
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
              isRead: false,
              labelIds: [1],
              mailId: 500,
              recipients: [{ id: 200, type: 'character', name: 'Recipient' }],
              sender: { id: 100, name: 'Sender', type: 'character' },
              sentAt: '2026-08-27T10:00:00Z',
              subject: 'Subject',
            },
          ],
          nextLastMailId: null,
        }),
      )
      .mockResolvedValueOnce(
        result({
          body: 'First & second\n\nFly 고',
          isRead: true,
          labelIds: [4],
          mailId: 44,
          recipients: [],
          sender: null,
          sentAt: '2026-08-27T11:00:00Z',
          subject: 'Detail',
        }),
      )

    await expect(listMailHeaders(characterId, {}, subjectLifecycleId)).resolves.toMatchObject({
      characterId,
      messages: [{ mailId: 500, sender: { name: 'Sender' } }],
      ...metadata,
    })
    await expect(getMailDetail(characterId, 44, subjectLifecycleId)).resolves.toMatchObject({
      body: 'First & second\n\nFly 고',
      mailId: 44,
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
      { characterId, labels: [3, 5, 9], lastMailId: 800, subjectLifecycleId },
      { subjectLifecycleId },
    )
  })

  test('preserves mapped labels, mailing lists, searches, and CSPA charges', async () => {
    mocks.executeRepresentation
      .mockResolvedValueOnce(
        result({
          labels: [{ color: '#ffffff', labelId: 2, name: 'Inbox', unreadCount: 5 }],
          totalUnreadCount: 7,
        }),
      )
      .mockResolvedValueOnce(result([{ mailingListId: 99, name: 'A List' }]))
      .mockResolvedValueOnce(result([{ id: 20, name: 'Character', type: 'character' }]))
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
    await expect(
      calculateMailCspaCharge(characterId, [20], subjectLifecycleId),
    ).resolves.toStrictEqual({
      characterId,
      cost: 12.5,
    })
  })

  test('retains only addressable universe recipient categories', async () => {
    mocks.resolveUniverseIds.mockResolvedValue([
      { category: 'alliance', id: 1, name: 'Alliance' },
      { category: 'character', id: 2, name: 'Character' },
      { category: 'faction', id: 4, name: 'Faction' },
    ])
    await expect(resolveMailRecipients(['Alliance', 'Character'])).resolves.toStrictEqual({
      recipients: [
        { id: 1, name: 'Alliance', type: 'alliance' },
        { id: 2, name: 'Character', type: 'character' },
      ],
    })
  })

  test('maps callable failures to safe read outcomes', async () => {
    mocks.executeRepresentation.mockRejectedValueOnce(providerError(403))
    await expect(listMailHeaders(characterId, {}, subjectLifecycleId)).rejects.toStrictEqual(
      new MailAuthorizationError(403),
    )
    mocks.executeRepresentation.mockRejectedValueOnce(providerError(404))
    await expect(getMailDetail(characterId, 99, subjectLifecycleId)).rejects.toStrictEqual(
      new MailNotFoundError(),
    )
  })
})

describe('mail mutations', () => {
  test('returns mapped mutation results and preserves callable inputs', async () => {
    await expect(
      sendMail(
        characterId,
        { body: 'Body', recipients: [{ id: 100, type: 'character' }], subject: 'Subject' },
        subjectLifecycleId,
      ),
    ).resolves.toStrictEqual({ characterId, mailId: 7001 })
    await expect(
      createMailLabel(characterId, { color: '#fe0000', name: 'Important' }, subjectLifecycleId),
    ).resolves.toStrictEqual({ characterId, labelId: 31 })
    await expect(
      updateMail(characterId, 51, { labels: [4, 2], read: false }, subjectLifecycleId),
    ).resolves.toStrictEqual({ characterId, mailId: 51 })
    await expect(deleteMail(characterId, 51, subjectLifecycleId)).resolves.toStrictEqual({
      characterId,
      mailId: 51,
    })
    await expect(deleteMailLabel(characterId, 8, subjectLifecycleId)).resolves.toStrictEqual({
      characterId,
      labelId: 8,
    })
    expect(
      mocks.executeMutationRepresentation.mock.calls.map(([definition]) => definition.operation),
    ).toStrictEqual([
      'mail-send',
      'mail-create-label',
      'mail-update',
      'mail-delete',
      'mail-delete-label',
    ])
  })

  test('maps ambiguous and definitive callable failures to sanitized mutation errors', async () => {
    mocks.executeMutationRepresentation.mockRejectedValueOnce(
      new EsiTransportError({
        cause: new Error('socket closed'),
        operationId: 'PostCharactersCharacterIdMail',
        phase: 'request',
        reason: 'network',
      }),
    )
    await expect(
      sendMail(
        characterId,
        { body: 'Body', recipients: [{ id: 100, type: 'character' }], subject: 'Subject' },
        subjectLifecycleId,
      ),
    ).rejects.toStrictEqual(new MailDeliveryUnknownError())
    mocks.executeMutationRepresentation.mockRejectedValueOnce(providerError(422))
    await expect(
      sendMail(
        characterId,
        { body: 'Body', recipients: [{ id: 100, type: 'character' }], subject: 'Subject' },
        subjectLifecycleId,
      ),
    ).rejects.toStrictEqual(new MailRejectedError())
    mocks.executeMutationRepresentation.mockRejectedValueOnce(providerError(409))
    await expect(
      createMailLabel(characterId, { name: 'Label' }, subjectLifecycleId),
    ).rejects.toStrictEqual(new MailMutationRejectedError())
    mocks.executeRepresentation.mockRejectedValueOnce(providerError(400))
    await expect(
      calculateMailCspaCharge(characterId, [20], subjectLifecycleId),
    ).rejects.toStrictEqual(new MailCspaRejectedError())
  })
})

function result<Data>(data: Data) {
  return { data, ...metadata }
}

function providerError(status: number) {
  return new EsiHttpError({
    cause: new Error('provider failure'),
    operationId: 'GetCharactersCharacterIdMail',
    responseBodyText: '{}',
    status,
  })
}
