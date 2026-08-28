import { createMailClient } from '@evespace/esi-client/domains/mail'
import { eveDescriptionToPlainText } from '../eve-description.js'
import { EsiQuotaError } from '../esi-resilience/cooldowns.js'
import { getEsiResilienceLayer } from '../esi-resilience/resilience.js'
import { createEsiTransport, EsiTransportError } from '../esi-resilience/transport.js'
import type { EsiCachedResult } from '../esi-resilience/types.js'
import { ScopeRequiredError, TokenRefreshUnavailableError } from '../token-service.js'
import { resolveUniverseNames, type UniverseName } from '../universe-names-service.js'

type MailRecipientType = 'alliance' | 'character' | 'corporation' | 'mailing_list'
type MailPartyType = MailRecipientType | 'unknown'

interface MailParty {
  id: number
  type: MailPartyType
  name: string | null
}

interface SendMailRecipient {
  id: number
  type: MailRecipientType
}

interface MailHeader {
  mailId: number
  sender: MailParty | null
  recipients: MailParty[]
  subject: string | null
  sentAt: string | null
  labelIds: number[]
  isRead: boolean | null
}

export type MailHeaderPage = MailReadMetadata & {
  characterId: number
  messages: MailHeader[]
  nextLastMailId: number | null
}

export type MailDetail = MailReadMetadata & {
  characterId: number
  mailId: number
  sender: MailParty | null
  recipients: MailParty[]
  subject: string | null
  sentAt: string | null
  labelIds: number[]
  isRead: boolean | null
  body: string | null
}

export const mailLabelColors = [
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
] as const

type MailLabelColor = (typeof mailLabelColors)[number]

interface MailLabel {
  labelId: number | null
  name: string | null
  color: MailLabelColor | null
  unreadCount: number | null
}

export type MailLabels = MailReadMetadata & {
  characterId: number
  labels: MailLabel[]
  totalUnreadCount: number | null
}

interface MailingList {
  mailingListId: number
  name: string
}

export type MailingLists = MailReadMetadata & {
  characterId: number
  mailingLists: MailingList[]
}

export interface SendMailInput {
  recipients: readonly SendMailRecipient[]
  subject: string
  body: string
  approvedCost?: number
}

export interface UpdateMailInput {
  read?: boolean
  labels?: readonly number[]
}

export interface CreateMailLabelInput {
  name: string
  color?: MailLabelColor
}

export interface SentMailResult {
  characterId: number
  mailId: number
}

export interface CreatedMailLabelResult {
  characterId: number
  labelId: number
}

export interface UpdatedMailResult {
  characterId: number
  mailId: number
}

export interface DeletedMailResult {
  characterId: number
  mailId: number
}

export interface DeletedMailLabelResult {
  characterId: number
  labelId: number
}

type MailReadMetadata = Omit<EsiCachedResult<unknown>, 'data'>

interface EsiMailRecipient {
  recipient_id: number
  recipient_type: MailRecipientType
}

interface EsiMailParties {
  from?: number
  recipients?: EsiMailRecipient[]
}

class InvalidMailHeaderError extends Error {}

export class MailAuthorizationError extends Error {
  constructor(readonly status: 401 | 403) {
    super('EVE mail authorization was rejected')
    this.name = 'MailAuthorizationError'
  }
}

export class MailNotFoundError extends Error {
  constructor() {
    super('EVE mail was not found')
    this.name = 'MailNotFoundError'
  }
}

export class MailDeliveryUnknownError extends Error {
  constructor() {
    super('EVE mail delivery could not be confirmed')
    this.name = 'MailDeliveryUnknownError'
  }
}

export class MailRejectedError extends Error {
  constructor() {
    super('EVE rejected the mail')
    this.name = 'MailRejectedError'
  }
}

export class MailMutationRejectedError extends Error {
  constructor() {
    super('EVE rejected the mail change')
    this.name = 'MailMutationRejectedError'
  }
}

export class MailUnavailableError extends Error {
  constructor() {
    super('EVE mail is temporarily unavailable')
    this.name = 'MailUnavailableError'
  }
}

export async function listMailHeaders(
  characterId: number,
  options: { labels?: readonly number[] | null; lastMailId?: number | null } = {},
): Promise<MailHeaderPage> {
  const labels = normalizeLabelFilter(options.labels)
  const lastMailId = options.lastMailId ?? null
  try {
    const { data, ...metadata } = await getEsiResilienceLayer().getCharacter<{
      messages: MailHeader[]
      nextLastMailId: number | null
    }>({
      operation: 'mail-headers',
      inputs: { characterId, labels, lastMailId },
      load: async (authority, revalidation) => {
        const response = await createMailClient({
          fetch: createEsiTransport('mail-headers', authority.principal),
          token: authority.accessToken,
        })
          .withMetadata()
          .listHeaders(characterId, {
            ...(labels ? { labels } : {}),
            ...(lastMailId === null ? {} : { lastMailId }),
            ...revalidation,
          })
        const headers = response.data.map((header) => {
          if (header.mail_id === undefined) throw new InvalidMailHeaderError()
          return header as typeof header & { mail_id: number }
        })
        const parties = await enrichParties(characterId, headers)
        return {
          data: {
            messages: headers.map((header) => ({
              mailId: header.mail_id,
              sender: senderParty(header.from, parties),
              recipients: recipientParties(header.recipients, parties),
              subject: header.subject ?? null,
              sentAt: header.timestamp ?? null,
              labelIds: header.labels ?? [],
              isRead: header.is_read ?? null,
            })),
            nextLastMailId: headers.length === 50 ? headers.at(-1)!.mail_id : null,
          },
          meta: response.meta,
        }
      },
    })
    return { characterId, ...data, ...metadata }
  } catch (error) {
    throwMailReadError(error)
  }
}

export async function getMailDetail(characterId: number, mailId: number): Promise<MailDetail> {
  try {
    const { data, ...metadata } = await getEsiResilienceLayer().getCharacter<
      Omit<MailDetail, keyof MailReadMetadata | 'characterId'>
    >({
      operation: 'mail-message',
      inputs: { characterId, mailId },
      load: async (authority, revalidation) => {
        const response = await createMailClient({
          fetch: createEsiTransport('mail-message', authority.principal),
          token: authority.accessToken,
        })
          .withMetadata()
          .get(characterId, mailId, revalidation)
        const parties = await enrichParties(characterId, [response.data])
        return {
          data: {
            mailId,
            sender: senderParty(response.data.from, parties),
            recipients: recipientParties(response.data.recipients, parties),
            subject: response.data.subject ?? null,
            sentAt: response.data.timestamp ?? null,
            labelIds: response.data.labels ?? [],
            isRead: response.data.read ?? null,
            body: eveDescriptionToPlainText(response.data.body) ?? null,
          },
          meta: response.meta,
        }
      },
    })
    return { characterId, ...data, ...metadata }
  } catch (error) {
    throwMailReadError(error, true)
  }
}

export async function getMailLabels(characterId: number): Promise<MailLabels> {
  try {
    const { data, ...metadata } = await getEsiResilienceLayer().getCharacter<{
      labels: MailLabel[]
      totalUnreadCount: number | null
    }>({
      operation: 'mail-labels',
      inputs: { characterId },
      load: async (authority, revalidation) => {
        const response = await createMailClient({
          fetch: createEsiTransport('mail-labels', authority.principal),
          token: authority.accessToken,
        })
          .withMetadata()
          .listLabels(characterId, revalidation)
        return {
          data: {
            labels: (response.data.labels ?? []).map((label) => ({
              labelId: label.label_id ?? null,
              name: label.name ?? null,
              color: label.color ?? null,
              unreadCount: label.unread_count ?? null,
            })),
            totalUnreadCount: response.data.total_unread_count ?? null,
          },
          meta: response.meta,
        }
      },
    })
    return { characterId, ...data, ...metadata }
  } catch (error) {
    throwMailReadError(error)
  }
}

export async function getMailingLists(characterId: number): Promise<MailingLists> {
  try {
    const { data, ...metadata } = await loadMailingLists(characterId)
    return { characterId, mailingLists: data, ...metadata }
  } catch (error) {
    throwMailReadError(error)
  }
}

export async function sendMail(characterId: number, input: SendMailInput): Promise<SentMailResult> {
  try {
    const response = await getEsiResilienceLayer().executeCharacterMutation({
      operation: 'mail-send',
      characterId,
      load: (authority) =>
        createMailClient({
          fetch: createEsiTransport('mail-send', authority.principal),
          token: authority.accessToken,
        })
          .withMetadata()
          .send(characterId, {
            body: {
              approved_cost: input.approvedCost ?? 0,
              body: input.body,
              recipients: input.recipients.map((recipient) => ({
                recipient_id: recipient.id,
                recipient_type: recipient.type,
              })),
              subject: input.subject,
            },
          }),
    })
    return { characterId, mailId: response.data }
  } catch (error) {
    throwMailMutationError(error, 'send')
  }
}

export async function createMailLabel(
  characterId: number,
  input: CreateMailLabelInput,
): Promise<CreatedMailLabelResult> {
  try {
    const response = await getEsiResilienceLayer().executeCharacterMutation({
      operation: 'mail-create-label',
      characterId,
      load: (authority) =>
        createMailClient({
          fetch: createEsiTransport('mail-create-label', authority.principal),
          token: authority.accessToken,
        })
          .withMetadata()
          .createLabel(characterId, {
            body: { name: input.name, ...(input.color ? { color: input.color } : {}) },
          }),
    })
    return { characterId, labelId: response.data }
  } catch (error) {
    throwMailMutationError(error, 'organize')
  }
}

export async function updateMail(
  characterId: number,
  mailId: number,
  input: UpdateMailInput,
): Promise<UpdatedMailResult> {
  try {
    await getEsiResilienceLayer().executeCharacterMutation({
      operation: 'mail-update',
      characterId,
      load: (authority) =>
        createMailClient({
          fetch: createEsiTransport('mail-update', authority.principal),
          token: authority.accessToken,
        })
          .withMetadata()
          .update(characterId, mailId, {
            body: {
              ...(input.labels === undefined ? {} : { labels: [...input.labels] }),
              ...(input.read === undefined ? {} : { read: input.read }),
            },
          }),
    })
    return { characterId, mailId }
  } catch (error) {
    throwMailMutationError(error, 'organize')
  }
}

export async function deleteMail(characterId: number, mailId: number): Promise<DeletedMailResult> {
  try {
    await getEsiResilienceLayer().executeCharacterMutation({
      operation: 'mail-delete',
      characterId,
      load: (authority) =>
        createMailClient({
          fetch: createEsiTransport('mail-delete', authority.principal),
          token: authority.accessToken,
        })
          .withMetadata()
          .deleteMail(characterId, mailId),
    })
    return { characterId, mailId }
  } catch (error) {
    if (errorStatus(error) === 404) return { characterId, mailId }
    throwMailMutationError(error, 'organize')
  }
}

export async function deleteMailLabel(
  characterId: number,
  labelId: number,
): Promise<DeletedMailLabelResult> {
  try {
    await getEsiResilienceLayer().executeCharacterMutation({
      operation: 'mail-delete-label',
      characterId,
      load: (authority) =>
        createMailClient({
          fetch: createEsiTransport('mail-delete-label', authority.principal),
          token: authority.accessToken,
        })
          .withMetadata()
          .deleteLabel(characterId, labelId),
    })
    return { characterId, labelId }
  } catch (error) {
    if (errorStatus(error) === 404) return { characterId, labelId }
    throwMailMutationError(error, 'organize')
  }
}

function normalizeLabelFilter(labels: readonly number[] | null | undefined) {
  if (!labels?.length) return null
  return [...new Set(labels)].toSorted((left, right) => left - right)
}

async function loadMailingLists(characterId: number) {
  return getEsiResilienceLayer().getCharacter<MailingList[]>({
    operation: 'mail-lists',
    inputs: { characterId },
    load: async (authority, revalidation) => {
      const response = await createMailClient({
        fetch: createEsiTransport('mail-lists', authority.principal),
        token: authority.accessToken,
      })
        .withMetadata()
        .listMailingLists(characterId, revalidation)
      return {
        data: response.data.map((list) => ({
          mailingListId: list.mailing_list_id,
          name: list.name,
        })),
        meta: response.meta,
      }
    },
  })
}

async function enrichParties(characterId: number, records: readonly EsiMailParties[]) {
  const universeIds = new Set<number>()
  const mailingListIds = new Set<number>()
  for (const record of records) {
    if (record.from !== undefined) universeIds.add(record.from)
    for (const recipient of record.recipients ?? []) {
      if (recipient.recipient_type === 'mailing_list') mailingListIds.add(recipient.recipient_id)
      else universeIds.add(recipient.recipient_id)
    }
  }

  const [universeNames, mailingListNames] = await Promise.all([
    resolveNamesBestEffort([...universeIds]),
    resolveMailingListNamesBestEffort(characterId, mailingListIds.size > 0),
  ])
  return { universeNames, mailingListNames }
}

async function resolveNamesBestEffort(ids: number[]) {
  if (ids.length === 0) return new Map<number, UniverseName>()
  try {
    return await resolveUniverseNames(ids)
  } catch {
    return new Map<number, UniverseName>()
  }
}

async function resolveMailingListNamesBestEffort(characterId: number, needed: boolean) {
  if (!needed) return new Map<number, string>()
  try {
    const result = await loadMailingLists(characterId)
    return new Map(result.data.map((list) => [list.mailingListId, list.name]))
  } catch {
    return new Map<number, string>()
  }
}

function senderParty(
  id: number | undefined,
  parties: Awaited<ReturnType<typeof enrichParties>>,
): MailParty | null {
  if (id === undefined) return null
  const resolved = parties.universeNames.get(id)
  if (resolved && isUniversePartyType(resolved.category))
    return { id, type: resolved.category, name: resolved.name }
  return { id, type: 'unknown', name: null }
}

function recipientParties(
  recipients: readonly EsiMailRecipient[] | undefined,
  parties: Awaited<ReturnType<typeof enrichParties>>,
): MailParty[] {
  return (recipients ?? []).map((recipient) => ({
    id: recipient.recipient_id,
    type: recipient.recipient_type,
    name:
      recipient.recipient_type === 'mailing_list'
        ? (parties.mailingListNames.get(recipient.recipient_id) ?? null)
        : parties.universeNames.get(recipient.recipient_id)?.category === recipient.recipient_type
          ? parties.universeNames.get(recipient.recipient_id)!.name
          : null,
  }))
}

function isUniversePartyType(value: string): value is Exclude<MailRecipientType, 'mailing_list'> {
  return value === 'alliance' || value === 'character' || value === 'corporation'
}

function throwMailReadError(error: unknown, detail = false): never {
  preserveSharedError(error)
  const status = errorStatus(error)
  if (status === 401 || status === 403) throw new MailAuthorizationError(status)
  if (detail && status === 404) throw new MailNotFoundError()
  throw new MailUnavailableError()
}

function throwMailMutationError(error: unknown, kind: 'send' | 'organize'): never {
  preserveSharedError(error)
  const status = errorStatus(error)
  if (status === 401 || status === 403) throw new MailAuthorizationError(status)
  if (kind === 'send' && isAmbiguousSendFailure(error)) throw new MailDeliveryUnknownError()
  if (status !== undefined && status >= 400 && status < 500) {
    if (kind === 'send') throw new MailRejectedError()
    throw new MailMutationRejectedError()
  }
  throw new MailUnavailableError()
}

function preserveSharedError(error: unknown): void {
  if (
    error instanceof ScopeRequiredError ||
    error instanceof TokenRefreshUnavailableError ||
    error instanceof EsiQuotaError
  )
    throw error
}

function isAmbiguousSendFailure(error: unknown) {
  const code = errorCode(error)
  return (
    error instanceof EsiTransportError ||
    (error instanceof Error && error.name === 'EsiResourceRevisionUnavailableError') ||
    code === 'ESI_RESPONSE_PARSE_ERROR' ||
    code === 'ESI_RESPONSE_VALIDATION_ERROR'
  )
}

function errorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined
  const status = Number(error.status)
  return Number.isInteger(status) ? status : undefined
}
