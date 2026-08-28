import { testClient } from 'hono/testing'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class CharacterOwnershipConflictError extends Error {}
  class CharacterTokenNotFoundError extends Error {}
  class MailAuthorizationError extends Error {}
  class MailDeliveryUnknownError extends Error {}
  class MailMutationRejectedError extends Error {}
  class MailNotFoundError extends Error {}
  class MailRejectedError extends Error {}

  return {
    CharacterOwnershipConflictError,
    CharacterTokenNotFoundError,
    MailAuthorizationError,
    MailDeliveryUnknownError,
    MailMutationRejectedError,
    MailNotFoundError,
    MailRejectedError,
    attachCharacter: vi.fn(),
    consumeOAuthState: vi.fn(),
    createMailLabel: vi.fn(),
    deleteCharacter: vi.fn(),
    deleteMail: vi.fn(),
    deleteMailLabel: vi.fn(),
    deleteSession: vi.fn(),
    findCharacterToken: vi.fn(),
    findOwnedCharacter: vi.fn(),
    findSession: vi.fn(),
    getMailDetail: vi.fn(),
    getMailingLists: vi.fn(),
    getMailLabels: vi.fn(),
    listMailHeaders: vi.fn(),
    listUserCharacters: vi.fn(),
    reauthorizeCharacter: vi.fn(),
    saveLogin: vi.fn(),
    sendMail: vi.fn(),
    setMainCharacter: vi.fn(),
    storeOAuthState: vi.fn(),
    updateCharacterToken: vi.fn(),
    updateMail: vi.fn(),
  }
})

vi.mock('../src/auth-store.js', () => ({
  CharacterOwnershipConflictError: mocks.CharacterOwnershipConflictError,
  CharacterTokenNotFoundError: mocks.CharacterTokenNotFoundError,
  attachCharacter: mocks.attachCharacter,
  consumeOAuthState: mocks.consumeOAuthState,
  deleteCharacter: mocks.deleteCharacter,
  deleteSession: mocks.deleteSession,
  findCharacterToken: mocks.findCharacterToken,
  findOwnedCharacter: mocks.findOwnedCharacter,
  findSession: mocks.findSession,
  listUserCharacters: mocks.listUserCharacters,
  reauthorizeCharacter: mocks.reauthorizeCharacter,
  saveLogin: mocks.saveLogin,
  setMainCharacter: mocks.setMainCharacter,
  storeOAuthState: mocks.storeOAuthState,
  updateCharacterToken: mocks.updateCharacterToken,
}))

vi.mock('../src/db/client.js', () => ({ db: {}, sql: vi.fn() }))

vi.mock('../src/env.js', () => ({
  env: {
    ESI_USER_AGENT: 'EveSpace/Test',
    EVE_CALLBACK_URL: 'http://localhost:8788/auth/eve/callback',
    PORT: 8788,
    SESSION_COOKIE_SECURE: false,
    WEB_ORIGIN: 'http://localhost:3000',
  },
  getSsoConfig: () => ({
    callbackUrl: 'http://localhost:8788/auth/eve/callback',
    clientId: 'test-client',
    clientSecret: 'test-secret',
    encryptionKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    scopes: [],
  }),
  isSsoConfigured: () => true,
}))

vi.mock('../src/mail/service.js', () => ({
  mailLabelColors: [
    '#0000fe',
    '#006634',
    '#0099ff',
    '#00ff33',
    '#01ffff',
    '#349800',
    '#660066',
    '#666666',
    '#999999',
    '#99ffff',
    '#9a0000',
    '#ccff9a',
    '#e6e6e6',
    '#fe0000',
    '#ff6600',
    '#ffff01',
    '#ffffcd',
    '#ffffff',
  ],
  MailAuthorizationError: mocks.MailAuthorizationError,
  MailDeliveryUnknownError: mocks.MailDeliveryUnknownError,
  MailMutationRejectedError: mocks.MailMutationRejectedError,
  MailNotFoundError: mocks.MailNotFoundError,
  MailRejectedError: mocks.MailRejectedError,
  createMailLabel: mocks.createMailLabel,
  deleteMail: mocks.deleteMail,
  deleteMailLabel: mocks.deleteMailLabel,
  getMailDetail: mocks.getMailDetail,
  getMailingLists: mocks.getMailingLists,
  getMailLabels: mocks.getMailLabels,
  listMailHeaders: mocks.listMailHeaders,
  sendMail: mocks.sendMail,
  updateMail: mocks.updateMail,
}))

import { EsiQuotaError } from '../src/esi-resilience/cooldowns.js'
import { app } from '../src/index.js'
import { mailRoutes } from '../src/mail/routes.js'
import {
  MailAuthorizationError,
  MailDeliveryUnknownError,
  MailMutationRejectedError,
  MailNotFoundError,
  MailRejectedError,
} from '../src/mail/service.js'
import { ScopeRequiredError, TokenRefreshUnavailableError } from '../src/token-service.js'

const routerClient = testClient(mailRoutes)
const mountedClient = testClient(app)
const characterId = 90_000_001
const mainCharacterId = 90_000_099
const mailId = 7001
const labelId = 31
const sensitiveValues = [
  'session-bearer-secret',
  'access-token-secret',
  'refresh-token-secret',
  'encrypted-token-secret',
  'private-subject-secret',
  'private-body-secret',
  'recipient-secret',
  'raw-provider-secret',
]
const sessionHeaders = { Cookie: `eve_space_session=${sensitiveValues[0]}` }
const corsSessionHeaders = { ...sessionHeaders, Origin: 'http://localhost:3000' }
const altCharacter = {
  characterId,
  name: 'Mail Alt',
  corporationId: 98_000_001,
  allianceId: null,
  isMain: false,
  subjectLifecycleId: 'de1e1285-0d02-4dd0-9ca4-c3b7a28e0011',
}
const session = {
  userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
  mainCharacter: {
    ...altCharacter,
    characterId: mainCharacterId,
    name: 'Main Pilot',
    isMain: true,
    subjectLifecycleId: '614247fe-7206-4a65-8783-30670002d833',
  },
}
const metadata = {
  cachedUntil: '2026-08-27T12:00:30.000Z',
  validatedAt: '2026-08-27T12:00:00.000Z',
  source: 'esi',
  stale: false,
  quota: { group: 'char-social', remaining: 598 },
}
const headerPage = {
  characterId,
  messages: [
    {
      mailId,
      sender: { id: 91, type: 'character', name: 'Sender Pilot' },
      recipients: [
        { id: 92, type: 'corporation', name: 'Recipient Corp' },
        { id: 93, type: 'mailing_list', name: null },
      ],
      subject: 'Route DTO subject',
      sentAt: '2026-08-27T11:55:00Z',
      labelIds: [3, 9],
      isRead: false,
    },
  ],
  nextLastMailId: 6952,
  ...metadata,
}
const labelsDto = {
  characterId,
  labels: [
    { labelId: 1, name: 'Inbox', color: '#ffffff', unreadCount: 4 },
    { labelId: null, name: null, color: null, unreadCount: null },
  ],
  totalUnreadCount: 4,
  ...metadata,
}
const listsDto = {
  characterId,
  mailingLists: [{ mailingListId: 77, name: 'Alliance Logistics' }],
  ...metadata,
}
const detailDto = {
  characterId,
  mailId,
  sender: { id: 91, type: 'character', name: 'Sender Pilot' },
  recipients: [{ id: 92, type: 'corporation', name: 'Recipient Corp' }],
  subject: 'Route detail subject',
  sentAt: '2026-08-27T11:55:00Z',
  labelIds: [3],
  isRead: true,
  body: '<p>Untrusted route detail</p>',
  ...metadata,
}
const sendInput = {
  recipients: [
    { id: 91, type: 'alliance' as const },
    { id: 92, type: 'character' as const },
    { id: 93, type: 'corporation' as const },
    { id: 94, type: 'mailing_list' as const },
  ],
  subject: 'Subject',
  body: 'Body',
}

beforeEach(() => {
  mocks.findSession.mockResolvedValue(session)
  mocks.findOwnedCharacter.mockResolvedValue(altCharacter)
  mocks.listMailHeaders.mockResolvedValue(headerPage)
  mocks.getMailLabels.mockResolvedValue(labelsDto)
  mocks.getMailingLists.mockResolvedValue(listsDto)
  mocks.getMailDetail.mockResolvedValue(detailDto)
  mocks.sendMail.mockResolvedValue({ characterId, mailId: 7002 })
  mocks.createMailLabel.mockResolvedValue({ characterId, labelId })
  mocks.updateMail.mockResolvedValue({ characterId, mailId })
  mocks.deleteMail.mockResolvedValue({ characterId, mailId })
  mocks.deleteMailLabel.mockResolvedValue({ characterId, labelId })
})

describe('typed mail route successes', () => {
  test('returns exact DTOs, statuses, service arguments, and private headers for all nine routes', async () => {
    const headers = await routerClient[':characterId'].mail.$get(
      {
        param: { characterId: String(characterId) },
        query: { labels: ['9', '3'], lastMailId: '800' },
      },
      { headers: sessionHeaders },
    )
    expect(headers.status).toBe(200)
    await expect(headers.json()).resolves.toEqual(headerPage)
    expect(mocks.listMailHeaders).toHaveBeenCalledWith(characterId, {
      labels: [3, 9],
      lastMailId: 800,
    })

    const sent = await routerClient[':characterId'].mail.$post(
      { param: { characterId: String(characterId) }, json: sendInput },
      { headers: sessionHeaders },
    )
    expect(sent.status).toBe(201)
    await expect(sent.json()).resolves.toEqual({ characterId, mailId: 7002 })
    expect(mocks.sendMail).toHaveBeenCalledWith(characterId, {
      ...sendInput,
      approvedCost: 0,
    })

    const labels = await routerClient[':characterId'].mail.labels.$get(
      { param: { characterId: String(characterId) } },
      { headers: sessionHeaders },
    )
    expect(labels.status).toBe(200)
    await expect(labels.json()).resolves.toEqual(labelsDto)
    expect(mocks.getMailLabels).toHaveBeenCalledWith(characterId)

    const createdLabel = await routerClient[':characterId'].mail.labels.$post(
      {
        param: { characterId: String(characterId) },
        json: { name: 'Priority', color: '#fe0000' },
      },
      { headers: sessionHeaders },
    )
    expect(createdLabel.status).toBe(201)
    await expect(createdLabel.json()).resolves.toEqual({ characterId, labelId })
    expect(mocks.createMailLabel).toHaveBeenCalledWith(characterId, {
      name: 'Priority',
      color: '#fe0000',
    })

    const deletedLabel = await routerClient[':characterId'].mail.labels[':labelId'].$delete(
      { param: { characterId: String(characterId), labelId: String(labelId) } },
      { headers: sessionHeaders },
    )
    expect(deletedLabel.status).toBe(204)
    await expect(deletedLabel.text()).resolves.toBe('')
    expect(mocks.deleteMailLabel).toHaveBeenCalledWith(characterId, labelId)

    const lists = await routerClient[':characterId'].mail.lists.$get(
      { param: { characterId: String(characterId) } },
      { headers: sessionHeaders },
    )
    expect(lists.status).toBe(200)
    await expect(lists.json()).resolves.toEqual(listsDto)
    expect(mocks.getMailingLists).toHaveBeenCalledWith(characterId)

    const detail = await routerClient[':characterId'].mail[':mailId'].$get(
      { param: { characterId: String(characterId), mailId: String(mailId) } },
      { headers: sessionHeaders },
    )
    expect(detail.status).toBe(200)
    await expect(detail.json()).resolves.toEqual(detailDto)
    expect(mocks.getMailDetail).toHaveBeenCalledWith(characterId, mailId)

    const updated = await routerClient[':characterId'].mail[':mailId'].$put(
      {
        param: { characterId: String(characterId), mailId: String(mailId) },
        json: { read: false, labels: [] },
      },
      { headers: sessionHeaders },
    )
    expect(updated.status).toBe(204)
    await expect(updated.text()).resolves.toBe('')
    expect(mocks.updateMail).toHaveBeenCalledWith(characterId, mailId, {
      read: false,
      labels: [],
    })

    const deleted = await routerClient[':characterId'].mail[':mailId'].$delete(
      { param: { characterId: String(characterId), mailId: String(mailId) } },
      { headers: sessionHeaders },
    )
    expect(deleted.status).toBe(204)
    await expect(deleted.text()).resolves.toBe('')
    expect(mocks.deleteMail).toHaveBeenCalledWith(characterId, mailId)

    for (const response of [
      headers,
      sent,
      labels,
      createdLabel,
      deletedLabel,
      lists,
      detail,
      updated,
      deleted,
    ])
      expectPrivateNoStore(response, 'Cookie')
  })

  test('accepts a singleton label query without changing its shape', async () => {
    const response = await routerClient[':characterId'].mail.$get(
      { param: { characterId: String(characterId) }, query: { labels: '7' } },
      { headers: sessionHeaders },
    )

    expect(response.status).toBe(200)
    expect(mocks.listMailHeaders).toHaveBeenCalledWith(characterId, {
      labels: [7],
      lastMailId: undefined,
    })
  })
})

describe('mail route validation ordering', () => {
  const invalidIds = ['0', '-1', 'invalid', '1.5', '9007199254740992']

  test.each(invalidIds)('rejects character ID %s before protected work', async (value) => {
    expect.hasAssertions()
    await expectRejectedBeforeProtection(routerRequest(`/${value}/mail`))
  })

  test.each(invalidIds)('rejects mail ID %s before protected work', async (value) => {
    expect.hasAssertions()
    await expectRejectedBeforeProtection(routerRequest(`/${characterId}/mail/${value}`))
  })

  test.each(invalidIds)('rejects label ID %s before protected work', async (value) => {
    expect.hasAssertions()
    await expectRejectedBeforeProtection(
      routerRequest(`/${characterId}/mail/labels/${value}`, { method: 'DELETE' }),
    )
  })

  test.each(invalidIds)('rejects cursor ID %s before protected work', async (value) => {
    expect.hasAssertions()
    await expectRejectedBeforeProtection(routerRequest(`/${characterId}/mail?lastMailId=${value}`))
  })

  test.each([
    ['empty label', `/${characterId}/mail?labels=`],
    ['comma-delimited labels', `/${characterId}/mail?labels=1,2`],
    ['bracketed labels', `/${characterId}/mail?labels=[1]`],
    ['duplicate labels', `/${characterId}/mail?labels=2&labels=2`],
    [
      'more than 25 labels',
      `/${characterId}/mail?${Array.from({ length: 26 }, (_, index) => `labels=${index + 1}`).join('&')}`,
    ],
    ['invalid label', `/${characterId}/mail?labels=invalid`],
    ['unknown query field', `/${characterId}/mail?unknown=1`],
    ['duplicate cursor', `/${characterId}/mail?lastMailId=8&lastMailId=7`],
  ])('rejects %s before protected work', async (_name, path) => {
    expect.hasAssertions()
    await expectRejectedBeforeProtection(routerRequest(path))
  })

  test.each([
    ['missing recipients', { subject: '', body: '' }],
    ['missing subject', { recipients: [{ id: 1, type: 'character' }], body: '' }],
    ['missing body', { recipients: [{ id: 1, type: 'character' }], subject: '' }],
    [
      'extra root field',
      { recipients: [{ id: 1, type: 'character' }], subject: '', body: '', extra: true },
    ],
    ['wrong root type', []],
    ['wrong recipients type', { recipients: 'recipient', subject: '', body: '' }],
    ['no recipients', { recipients: [], subject: '', body: '' }],
    [
      'more than 50 recipients',
      {
        recipients: Array.from({ length: 51 }, (_, index) => ({
          id: index + 1,
          type: 'character',
        })),
        subject: '',
        body: '',
      },
    ],
    ['recipient ID zero', sendBodyWithRecipient({ id: 0, type: 'character' })],
    ['recipient ID negative', sendBodyWithRecipient({ id: -1, type: 'character' })],
    ['recipient ID fractional', sendBodyWithRecipient({ id: 1.5, type: 'character' })],
    [
      'recipient ID unsafe',
      sendBodyWithRecipient({ id: Number.MAX_SAFE_INTEGER + 1, type: 'character' }),
    ],
    ['recipient ID wrong type', sendBodyWithRecipient({ id: '1', type: 'character' })],
    ['recipient missing ID', sendBodyWithRecipient({ type: 'character' })],
    ['recipient missing type', sendBodyWithRecipient({ id: 1 })],
    ['recipient invalid type', sendBodyWithRecipient({ id: 1, type: 'faction' })],
    ['recipient type wrong type', sendBodyWithRecipient({ id: 1, type: 1 })],
    [
      'recipient extra property',
      sendBodyWithRecipient({ id: 1, type: 'character', name: 'not accepted' }),
    ],
    [
      'subject too long',
      { recipients: [{ id: 1, type: 'character' }], subject: 's'.repeat(1001), body: '' },
    ],
    ['subject wrong type', { recipients: [{ id: 1, type: 'character' }], subject: 1, body: '' }],
    [
      'body too long',
      { recipients: [{ id: 1, type: 'character' }], subject: '', body: 'b'.repeat(10_001) },
    ],
    ['body wrong type', { recipients: [{ id: 1, type: 'character' }], subject: '', body: 1 }],
    ['approved cost negative', validSendBody({ approvedCost: -1 })],
    ['approved cost fractional', validSendBody({ approvedCost: 1.5 })],
    ['approved cost unsafe', validSendBody({ approvedCost: Number.MAX_SAFE_INTEGER + 1 })],
    ['approved cost wrong type', validSendBody({ approvedCost: '1' })],
    ['approved cost null', validSendBody({ approvedCost: null })],
  ])('rejects send body with %s before protected work', async (_name, body) => {
    expect.hasAssertions()
    await expectRejectedBeforeProtection(routerJsonRequest(`/${characterId}/mail`, 'POST', body))
  })

  test.each([
    ['missing name', {}],
    ['empty name', { name: '' }],
    ['name over 40 characters', { name: 'n'.repeat(41) }],
    ['name wrong type', { name: 1 }],
    ['unsupported color', { name: 'Label', color: '#123456' }],
    ['color wrong type', { name: 'Label', color: 1 }],
    ['extra property', { name: 'Label', extra: true }],
    ['wrong root type', []],
  ])('rejects label creation with %s before protected work', async (_name, body) => {
    expect.hasAssertions()
    await expectRejectedBeforeProtection(
      routerJsonRequest(`/${characterId}/mail/labels`, 'POST', body),
    )
  })

  test.each([
    ['empty update', {}],
    ['more than 25 labels', { labels: Array.from({ length: 26 }, (_, index) => index + 1) }],
    ['duplicate labels', { labels: [1, 1] }],
    ['zero label', { labels: [0] }],
    ['negative label', { labels: [-1] }],
    ['fractional label', { labels: [1.5] }],
    ['unsafe label', { labels: [Number.MAX_SAFE_INTEGER + 1] }],
    ['labels wrong type', { labels: '1' }],
    ['label item wrong type', { labels: ['1'] }],
    ['read wrong type', { read: 'false' }],
    ['extra property', { read: true, extra: true }],
    ['wrong root type', []],
  ])('rejects mail update with %s before protected work', async (_name, body) => {
    expect.hasAssertions()
    await expectRejectedBeforeProtection(
      routerJsonRequest(`/${characterId}/mail/${mailId}`, 'PUT', body),
    )
  })

  test.each([
    ['send malformed JSON', `/${characterId}/mail`, 'POST', '{"recipients":'],
    ['create-label malformed JSON', `/${characterId}/mail/labels`, 'POST', '{"name":'],
    ['update malformed JSON', `/${characterId}/mail/${mailId}`, 'PUT', '{"read":'],
  ])('rejects %s before protected work', async (_name, path, method, body) => {
    expect.hasAssertions()
    await expectRejectedBeforeProtection(
      routerRequest(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
    )
  })

  test.each([
    ['missing content type', undefined],
    ['wrong content type', 'text/plain'],
  ])('rejects send JSON with %s before protected work', async (_name, contentType) => {
    expect.hasAssertions()
    await expectRejectedBeforeProtection(
      routerRequest(`/${characterId}/mail`, {
        method: 'POST',
        headers: contentType ? { 'Content-Type': contentType } : undefined,
        body: JSON.stringify(validSendBody()),
      }),
    )
  })
})

describe('mail route authentication and ownership', () => {
  test.each([
    ['read', `/${characterId}/mail`, {}],
    [
      'mutation',
      `/${characterId}/mail`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validSendBody()),
      },
    ],
  ])('rejects anonymous %s without ownership or mail work', async (_name, path, init) => {
    const response = await mailRoutes.request(path, init)

    expect(response.status).toBe(401)
    await expectSanitizedJson(response, {
      code: 'AUTH_REQUIRED',
      message: 'Log in with EVE Online first.',
    })
    expect(mocks.findSession).not.toHaveBeenCalled()
    expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()
    expectMailServicesUntouched()
  })

  test('returns identical 404s for missing and foreign characters without mail work', async () => {
    mocks.findOwnedCharacter.mockResolvedValue(null)

    const missing = await routerRequest(`/${characterId}/mail`)
    const foreign = await routerRequest(`/${characterId + 1}/mail`)
    const missingBody = await missing.json()
    const foreignBody = await foreign.json()

    expect(missing.status).toBe(404)
    expect(foreign.status).toBe(404)
    expect(missingBody).toEqual({ code: 'CHARACTER_NOT_FOUND', message: 'Character not found.' })
    expect(foreignBody).toEqual(missingBody)
    expectSanitizedText(JSON.stringify([missingBody, foreignBody]))
    expectMailServicesUntouched()
  })

  test('uses an attached alt selected by the path instead of the different session main', async () => {
    const response = await routerClient[':characterId'].mail[':mailId'].$get(
      { param: { characterId: String(characterId), mailId: String(mailId) } },
      { headers: sessionHeaders },
    )

    expect(session.mainCharacter.characterId).not.toBe(characterId)
    expect(response.status).toBe(200)
    expect(mocks.findOwnedCharacter).toHaveBeenCalledWith(session.userId, characterId)
    expect(mocks.getMailDetail).toHaveBeenCalledWith(characterId, mailId)
    expect(mocks.getMailDetail).not.toHaveBeenCalledWith(mainCharacterId, mailId)
  })

  test('does not expose session, token, provider, or submitted mail content in failures', async () => {
    mocks.sendMail.mockRejectedValueOnce(new Error(sensitiveValues.join(' ')))
    const response = await routerJsonRequest(`/${characterId}/mail`, 'POST', {
      recipients: [{ id: 91, type: 'character' }],
      subject: sensitiveValues[4],
      body: `${sensitiveValues[5]} ${sensitiveValues[6]}`,
    })

    expect(response.status).toBe(502)
    await expectSanitizedJson(response, {
      code: 'ESI_UNAVAILABLE',
      message: 'EVE mail is temporarily unavailable.',
    })
  })
})

describe('mail route scope wiring', () => {
  test.each(getScopeCases())(
    '$name uses only $requiredScope for missing and rejected authorization',
    async ({ service, request, requiredScope, message }) => {
      service.mockRejectedValueOnce(new ScopeRequiredError('deliberately-wrong-scope'))
      const missingScope = await request()
      expect(missingScope.status).toBe(403)
      await expectSanitizedJson(missingScope, {
        code: 'EVE_SCOPE_REQUIRED',
        message,
        requiredScope,
        authorizeUrl: authorizeUrl(characterId),
      })

      for (const status of [401, 403] as const) {
        service.mockRejectedValueOnce(new MailAuthorizationError(status))
        const rejected = await request()
        expect(rejected.status).toBe(403)
        await expectSanitizedJson(rejected, {
          code: 'EVE_REAUTH_REQUIRED',
          message: 'EVE authorization is no longer valid.',
          requiredScope,
          authorizeUrl: authorizeUrl(characterId),
        })
      }
    },
  )
})

describe('mail route safe failures', () => {
  test.each(getErrorFamilyCases())(
    '$name maps cooldowns with retry timing',
    async ({ service, request }) => {
      service.mockRejectedValueOnce(new EsiQuotaError(12))

      const response = await request()

      expect(response.status).toBe(429)
      expect(response.headers.get('retry-after')).toBe('12')
      await expectSanitizedJson(response, {
        code: 'ESI_COOLDOWN',
        message: 'EVE Online ESI is temporarily rate limited.',
        retryAfterSeconds: 12,
      })
    },
  )

  test.each(getErrorFamilyCases())(
    '$name maps token refresh unavailability without token material',
    async ({ service, request }) => {
      service.mockRejectedValueOnce(new TokenRefreshUnavailableError())

      const response = await request()

      expect(response.status).toBe(503)
      await expectSanitizedJson(response, {
        code: 'EVE_TOKEN_REFRESH_UNAVAILABLE',
        message: 'EVE token refresh is temporarily unavailable. Try again shortly.',
      })
    },
  )

  test.each(getErrorFamilyCases())(
    '$name sanitizes generic failures',
    async ({ service, request }) => {
      service.mockRejectedValueOnce(new Error(sensitiveValues.join(' ')))

      const response = await request()

      expect(response.status).toBe(502)
      await expectSanitizedJson(response, {
        code: 'ESI_UNAVAILABLE',
        message: 'EVE mail is temporarily unavailable.',
      })
    },
  )

  test('maps only detail absence to MAIL_NOT_FOUND', async () => {
    mocks.getMailDetail.mockRejectedValueOnce(new MailNotFoundError())
    const detail = await routerRequest(`/${characterId}/mail/${mailId}`)
    expect(detail.status).toBe(404)
    await expectSanitizedJson(detail, { code: 'MAIL_NOT_FOUND', message: 'Mail not found.' })

    mocks.listMailHeaders.mockRejectedValueOnce(new MailNotFoundError())
    const page = await routerRequest(`/${characterId}/mail`)
    expect(page.status).toBe(502)
    await expectSanitizedJson(page, {
      code: 'ESI_UNAVAILABLE',
      message: 'EVE mail is temporarily unavailable.',
    })
  })

  test.each([
    [
      'definitive send rejection',
      mocks.sendMail,
      () => routerJsonRequest(`/${characterId}/mail`, 'POST', validSensitiveSendBody()),
      new MailRejectedError(),
      422,
      { code: 'MAIL_REJECTED', message: 'EVE rejected the mail.' },
    ],
    [
      'ambiguous send delivery',
      mocks.sendMail,
      () => routerJsonRequest(`/${characterId}/mail`, 'POST', validSensitiveSendBody()),
      new MailDeliveryUnknownError(),
      502,
      {
        code: 'MAIL_DELIVERY_UNKNOWN',
        message: 'Mail delivery could not be confirmed. Inspect sent mail before sending again.',
      },
    ],
    [
      'organize rejection',
      mocks.updateMail,
      () => routerJsonRequest(`/${characterId}/mail/${mailId}`, 'PUT', { read: true }),
      new MailMutationRejectedError(),
      409,
      { code: 'MAIL_MUTATION_REJECTED', message: 'EVE rejected the mail change.' },
    ],
  ] as const)(
    'returns a sanitized %s outcome',
    async (_name, service, request, error, status, expectedBody) => {
      service.mockRejectedValueOnce(error)

      const response = await request()

      expect(response.status).toBe(status)
      await expectSanitizedJson(response, expectedBody)
    },
  )
})

describe('mounted mail routes', () => {
  test('serves representative typed read and mutation routes through the final mount', async () => {
    const read = await mountedClient.api.me.characters[':characterId'].mail.$get(
      { param: { characterId: String(characterId) }, query: {} },
      { headers: corsSessionHeaders },
    )
    const mutation = await mountedClient.api.me.characters[':characterId'].mail[':mailId'].$put(
      {
        param: { characterId: String(characterId), mailId: String(mailId) },
        json: { read: true },
      },
      { headers: corsSessionHeaders },
    )

    expect(read.status).toBe(200)
    await expect(read.json()).resolves.toEqual(headerPage)
    expect(mutation.status).toBe(204)
    await expect(mutation.text()).resolves.toBe('')
    expect(mocks.listMailHeaders).toHaveBeenCalledWith(characterId, {
      labels: undefined,
      lastMailId: undefined,
    })
    expect(mocks.updateMail).toHaveBeenCalledWith(characterId, mailId, { read: true })
    expectMountedSecurity(read)
    expectMountedSecurity(mutation)
  })

  test('uses global JSON validation handling before mounted authentication', async () => {
    const response = await app.request(`/api/me/characters/${characterId}/mail/0`, {
      headers: corsSessionHeaders,
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      message: 'Mail ID must be a positive integer.',
    })
    expect(mocks.findSession).not.toHaveBeenCalled()
    expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()
    expectMailServicesUntouched()
    expectMountedSecurity(response)
  })

  test('preserves route-local anonymous and ownership failures at the mounted path', async () => {
    const anonymous = await app.request(`/api/me/characters/${characterId}/mail`, {
      headers: { Origin: 'http://localhost:3000' },
    })
    expect(anonymous.status).toBe(401)
    await expectSanitizedJson(anonymous, {
      code: 'AUTH_REQUIRED',
      message: 'Log in with EVE Online first.',
    })
    expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()
    expectMailServicesUntouched()
    expectMountedSecurity(anonymous)

    mocks.findOwnedCharacter.mockResolvedValueOnce(null)
    const foreign = await app.request(`/api/me/characters/${characterId}/mail`, {
      headers: corsSessionHeaders,
    })
    expect(foreign.status).toBe(404)
    await expectSanitizedJson(foreign, {
      code: 'CHARACTER_NOT_FOUND',
      message: 'Character not found.',
    })
    expectMailServicesUntouched()
    expectMountedSecurity(foreign)
  })

  test('uses the global JSON error handler without leaking a mounted session failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.findSession.mockRejectedValueOnce(new Error(sensitiveValues.join(' ')))

    const response = await app.request(`/api/me/characters/${characterId}/mail`, {
      headers: corsSessionHeaders,
    })

    expect(response.status).toBe(500)
    await expectSanitizedJson(response, { message: 'Internal server error' })
    expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()
    expectMailServicesUntouched()
    expectMountedSecurity(response)
    consoleError.mockRestore()
  })
})

function getScopeCases() {
  return [
    {
      name: 'header read',
      service: mocks.listMailHeaders,
      request: () => routerRequest(`/${characterId}/mail`),
      requiredScope: 'esi-mail.read_mail.v1',
      message: 'Authorize mail access for this character.',
    },
    {
      name: 'label read',
      service: mocks.getMailLabels,
      request: () => routerRequest(`/${characterId}/mail/labels`),
      requiredScope: 'esi-mail.read_mail.v1',
      message: 'Authorize mail access for this character.',
    },
    {
      name: 'mailing-list read',
      service: mocks.getMailingLists,
      request: () => routerRequest(`/${characterId}/mail/lists`),
      requiredScope: 'esi-mail.read_mail.v1',
      message: 'Authorize mail access for this character.',
    },
    {
      name: 'detail read',
      service: mocks.getMailDetail,
      request: () => routerRequest(`/${characterId}/mail/${mailId}`),
      requiredScope: 'esi-mail.read_mail.v1',
      message: 'Authorize mail access for this character.',
    },
    {
      name: 'send mutation',
      service: mocks.sendMail,
      request: () => routerJsonRequest(`/${characterId}/mail`, 'POST', validSendBody()),
      requiredScope: 'esi-mail.send_mail.v1',
      message: 'Authorize sending mail for this character.',
    },
    {
      name: 'label creation',
      service: mocks.createMailLabel,
      request: () => routerJsonRequest(`/${characterId}/mail/labels`, 'POST', { name: 'Label' }),
      requiredScope: 'esi-mail.organize_mail.v1',
      message: 'Authorize mail organization for this character.',
    },
    {
      name: 'label deletion',
      service: mocks.deleteMailLabel,
      request: () => routerRequest(`/${characterId}/mail/labels/${labelId}`, { method: 'DELETE' }),
      requiredScope: 'esi-mail.organize_mail.v1',
      message: 'Authorize mail organization for this character.',
    },
    {
      name: 'mail update',
      service: mocks.updateMail,
      request: () => routerJsonRequest(`/${characterId}/mail/${mailId}`, 'PUT', { read: true }),
      requiredScope: 'esi-mail.organize_mail.v1',
      message: 'Authorize mail organization for this character.',
    },
    {
      name: 'mail deletion',
      service: mocks.deleteMail,
      request: () => routerRequest(`/${characterId}/mail/${mailId}`, { method: 'DELETE' }),
      requiredScope: 'esi-mail.organize_mail.v1',
      message: 'Authorize mail organization for this character.',
    },
  ]
}

function getErrorFamilyCases() {
  return [
    {
      name: 'read route',
      service: mocks.listMailHeaders,
      request: () => routerRequest(`/${characterId}/mail`),
    },
    {
      name: 'send route',
      service: mocks.sendMail,
      request: () => routerJsonRequest(`/${characterId}/mail`, 'POST', validSensitiveSendBody()),
    },
    {
      name: 'organize route',
      service: mocks.updateMail,
      request: () => routerJsonRequest(`/${characterId}/mail/${mailId}`, 'PUT', { read: true }),
    },
  ]
}

function routerRequest(path: string, init: RequestInit = {}) {
  return mailRoutes.request(path, {
    ...init,
    headers: {
      ...Object.fromEntries(new Headers(init.headers)),
      ...sessionHeaders,
    },
  })
}

function routerJsonRequest(path: string, method: string, body: unknown) {
  return routerRequest(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function validSendBody(overrides: Record<string, unknown> = {}) {
  return {
    recipients: [{ id: 1, type: 'character' }],
    subject: '',
    body: '',
    ...overrides,
  }
}

function validSensitiveSendBody() {
  return validSendBody({
    subject: sensitiveValues[4],
    body: `${sensitiveValues[5]} ${sensitiveValues[6]}`,
  })
}

function sendBodyWithRecipient(recipient: Record<string, unknown>) {
  return { recipients: [recipient], subject: '', body: '' }
}

async function expectRejectedBeforeProtection(responsePromise: Response | Promise<Response>) {
  const response = await responsePromise
  expect(response.status).toBe(400)
  expectPrivateNoStore(response, 'Cookie')
  expect(mocks.findSession).not.toHaveBeenCalled()
  expect(mocks.findOwnedCharacter).not.toHaveBeenCalled()
  expectMailServicesUntouched()
}

function expectMailServicesUntouched() {
  expect(mocks.findCharacterToken).not.toHaveBeenCalled()
  expect(mocks.updateCharacterToken).not.toHaveBeenCalled()
  for (const service of mailServiceMocks()) expect(service).not.toHaveBeenCalled()
}

function mailServiceMocks() {
  return [
    mocks.listMailHeaders,
    mocks.getMailDetail,
    mocks.getMailLabels,
    mocks.getMailingLists,
    mocks.sendMail,
    mocks.createMailLabel,
    mocks.updateMail,
    mocks.deleteMail,
    mocks.deleteMailLabel,
  ]
}

function expectPrivateNoStore(response: Response, vary: string) {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('vary')).toBe(vary)
}

function expectMountedSecurity(response: Response) {
  expectPrivateNoStore(response, 'Cookie, Origin')
  expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000')
  expect(response.headers.get('access-control-allow-credentials')).toBe('true')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN')
}

async function expectSanitizedJson(response: Response, expected: unknown) {
  const body = await response.json()
  expect(body).toEqual(expected)
  expectSanitizedText(JSON.stringify(body))
}

function expectSanitizedText(value: string) {
  for (const sensitive of sensitiveValues) expect(value).not.toContain(sensitive)
}

function authorizeUrl(selectedCharacterId: number) {
  return `http://localhost:8788/auth/eve/reauthorize/${selectedCharacterId}?returnTo=%2Fcharacters%2F${selectedCharacterId}%2Fmail`
}
