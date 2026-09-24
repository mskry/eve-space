import {
  isUniverseMailPartyType as isUniversePartyType,
  projectMailRecipients as recipientParties,
  projectMailSender as senderParty,
  sanitizeMailBody,
  type MailParty,
  type MailRecipientSource,
  type MailRecipientType,
} from '@eve-space/core-eve-projections/mail'
import { operationRegistry } from '@evespace/esi-client/operations'
import type {
  GetCharactersCharacterIdMailMailIdResponse,
  GetCharactersCharacterIdMailResponse,
  GetCharactersCharacterIdSearchResponse,
} from '@evespace/esi-client/types'
import { z } from 'zod'
import {
  EsiQuotaError,
  getEsiFailureStatus,
  isEsiMutationOutcomeUnknown,
} from '../esi-gateway/failures.js'
import {
  createCharacterEsiMutation,
  createCharacterEsiRead,
  type EsiReadResultMetadata,
} from '../esi-gateway/feature-execution.js'
import { ScopeRequiredError, TokenRefreshUnavailableError } from '../auth/token-errors.js'
import { resolveUniverseIds, resolveUniverseNames, type UniverseName } from '../universe/names.js'

const maximumMailRecipientSearchResults = 50
const mailSearchCategories = ['alliance', 'character', 'corporation'] as const

interface MailRecipient {
  id: number
  type: Exclude<MailRecipientType, 'mailing_list'>
  name: string
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

export interface MailRecipientResolutionResult {
  recipients: MailRecipient[]
}

export type MailRecipientSearchResult = MailReadMetadata & {
  characterId: number
  recipients: MailRecipient[]
}

export interface MailCspaChargeResult {
  characterId: number
  cost: number
}

type MailReadMetadata = EsiReadResultMetadata

interface EsiMailParties {
  from?: number
  recipients?: MailRecipientSource[]
}

const mailPartyCacheSchema = z.object({
  id: z.number(),
  name: z.string().nullable(),
  type: z.enum(['alliance', 'character', 'corporation', 'mailing_list', 'unknown']),
})
const mailHeaderCacheSchema = z.object({
  isRead: z.boolean().nullable(),
  labelIds: z.array(z.number()),
  mailId: z.number(),
  recipients: z.array(mailPartyCacheSchema),
  sender: mailPartyCacheSchema.nullable(),
  sentAt: z.string().nullable(),
  subject: z.string().nullable(),
})
const mailHeadersCacheSchema = z.object({
  messages: z.array(mailHeaderCacheSchema),
  nextLastMailId: z.number().nullable(),
})
const mailDetailCacheSchema = mailHeaderCacheSchema.extend({ body: z.string().nullable() })
const mailLabelsCacheSchema = z.object({
  labels: z.array(
    z.object({
      color: z.enum(mailLabelColors).nullable(),
      labelId: z.number().nullable(),
      name: z.string().nullable(),
      unreadCount: z.number().nullable(),
    }),
  ),
  totalUnreadCount: z.number().nullable(),
})
const mailingListsCacheSchema = z.array(z.object({ mailingListId: z.number(), name: z.string() }))
const mailRecipientSearchCacheSchema = z.array(
  z.object({
    id: z.number(),
    name: z.string(),
    type: z.enum(['alliance', 'character', 'corporation']),
  }),
)

interface MailHeadersRepresentationInput {
  characterId: number
  subjectLifecycleId: string
  labels: number[] | null
  lastMailId: number | null
}

const mailHeadersRead = createCharacterEsiRead({
  cacheSchema: mailHeadersCacheSchema,
  descriptor: operationRegistry.GetCharactersCharacterIdMail.transport,
  encodeRequest: (input: MailHeadersRepresentationInput) => ({
    path: { character_id: input.characterId },
    ...(input.labels === null && input.lastMailId === null
      ? {}
      : {
          query: {
            ...(input.labels === null ? {} : { labels: input.labels }),
            ...(input.lastMailId === null ? {} : { last_mail_id: input.lastMailId }),
          },
        }),
  }),
  map: (response, input) =>
    mapMailHeaders(input.characterId, input.subjectLifecycleId, response.data),
  name: 'mail-headers-core',
  operation: 'mail-headers',
})

interface MailDetailRepresentationInput {
  characterId: number
  subjectLifecycleId: string
  mailId: number
}

const mailDetailRead = createCharacterEsiRead({
  cacheSchema: mailDetailCacheSchema,
  descriptor: operationRegistry.GetCharactersCharacterIdMailMailId.transport,
  encodeRequest: (input: MailDetailRepresentationInput) => ({
    path: { character_id: input.characterId, mail_id: input.mailId },
  }),
  map: (response, input) =>
    mapMailDetail(input.characterId, input.subjectLifecycleId, input.mailId, response.data),
  name: 'mail-message-core',
  operation: 'mail-message',
})

interface CharacterRepresentationInput {
  characterId: number
  subjectLifecycleId: string
}

const mailLabelsRead = createCharacterEsiRead({
  cacheSchema: mailLabelsCacheSchema,
  descriptor: operationRegistry.GetCharactersCharacterIdMailLabels.transport,
  encodeRequest: (input: CharacterRepresentationInput) => ({
    path: { character_id: input.characterId },
  }),
  map: (response) => ({
    labels: (response.data.labels ?? []).map((label) => ({
      labelId: label.label_id ?? null,
      name: label.name ?? null,
      color: label.color ?? null,
      unreadCount: label.unread_count ?? null,
    })),
    totalUnreadCount: response.data.total_unread_count ?? null,
  }),
  name: 'mail-labels-core',
  operation: 'mail-labels',
})

const mailListsRead = createCharacterEsiRead({
  cacheSchema: mailingListsCacheSchema,
  descriptor: operationRegistry.GetCharactersCharacterIdMailLists.transport,
  encodeRequest: (input: CharacterRepresentationInput) => ({
    path: { character_id: input.characterId },
  }),
  map: (response): MailingList[] =>
    response.data.map((list) => ({
      mailingListId: list.mailing_list_id,
      name: list.name,
    })),
  name: 'mail-lists-core',
  operation: 'mail-lists',
})

interface CharacterSearchRepresentationInput {
  characterId: number
  search: string
  subjectLifecycleId: string
}

const characterSearchRead = createCharacterEsiRead({
  cacheSchema: mailRecipientSearchCacheSchema,
  descriptor: operationRegistry.GetCharactersCharacterIdSearch.transport,
  encodeRequest: (input: CharacterSearchRepresentationInput) => ({
    path: { character_id: input.characterId },
    query: {
      categories: [...mailSearchCategories],
      search: input.search,
    },
  }),
  map: (response) => mapMailRecipientSearch(response.data),
  name: 'character-search-mail',
  operation: 'character-search',
})

interface CharacterCspaChargeRepresentationInput {
  characterId: number
  characterIds: readonly number[]
  subjectLifecycleId: string
}

const characterCspaChargeRead = createCharacterEsiRead({
  cacheSchema: operationRegistry.PostCharactersCharacterIdCspa.responseSchema,
  descriptor: operationRegistry.PostCharactersCharacterIdCspa.transport,
  encodeRequest: (input: CharacterCspaChargeRepresentationInput) => ({
    path: { character_id: input.characterId },
    body: [...input.characterIds],
  }),
  map: (response): number => response.data,
  name: 'character-cspa-charge-mail',
  operation: 'character-cspa-charge',
})

const mailSendMutation = createCharacterEsiMutation({
  descriptor: operationRegistry.PostCharactersCharacterIdMail.transport,
  encodeRequest: ({
    characterId,
    input,
  }: {
    characterId: number
    input: SendMailInput
    subjectLifecycleId: string
  }) => ({
    path: { character_id: characterId },
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
  map: ({ data }, { characterId }): SentMailResult => ({ characterId, mailId: data }),
  name: 'mail-send-core',
  operation: 'mail-send',
})

interface MailCreateLabelRepresentationInput {
  characterId: number
  input: CreateMailLabelInput
  subjectLifecycleId: string
}

const mailCreateLabelMutation = createCharacterEsiMutation({
  descriptor: operationRegistry.PostCharactersCharacterIdMailLabels.transport,
  encodeRequest: ({ characterId, input }: MailCreateLabelRepresentationInput) => ({
    path: { character_id: characterId },
    body: { name: input.name, ...(input.color ? { color: input.color } : {}) },
  }),
  map: ({ data }, { characterId }): CreatedMailLabelResult => ({
    characterId,
    labelId: data,
  }),
  name: 'mail-create-label-core',
  operation: 'mail-create-label',
})

interface MailUpdateRepresentationInput {
  characterId: number
  mailId: number
  input: UpdateMailInput
  subjectLifecycleId: string
}

const mailUpdateMutation = createCharacterEsiMutation({
  descriptor: operationRegistry.PutCharactersCharacterIdMailMailId.transport,
  encodeRequest: ({ characterId, mailId, input }: MailUpdateRepresentationInput) => ({
    path: { character_id: characterId, mail_id: mailId },
    body: {
      ...(input.labels === undefined ? {} : { labels: [...input.labels] }),
      ...(input.read === undefined ? {} : { read: input.read }),
    },
  }),
  map: (_response, { characterId, mailId }): UpdatedMailResult => ({ characterId, mailId }),
  name: 'mail-update-core',
  operation: 'mail-update',
})

interface MailDeleteRepresentationInput {
  characterId: number
  mailId: number
  subjectLifecycleId: string
}

const mailDeleteMutation = createCharacterEsiMutation({
  descriptor: operationRegistry.DeleteCharactersCharacterIdMailMailId.transport,
  encodeRequest: (input: MailDeleteRepresentationInput) => ({
    path: { character_id: input.characterId, mail_id: input.mailId },
  }),
  map: (_response, { characterId, mailId }): DeletedMailResult => ({ characterId, mailId }),
  name: 'mail-delete-core',
  operation: 'mail-delete',
})

interface MailDeleteLabelRepresentationInput {
  characterId: number
  labelId: number
  subjectLifecycleId: string
}

const mailDeleteLabelMutation = createCharacterEsiMutation({
  descriptor: operationRegistry.DeleteCharactersCharacterIdMailLabelsLabelId.transport,
  encodeRequest: (input: MailDeleteLabelRepresentationInput) => ({
    path: { character_id: input.characterId, label_id: input.labelId },
  }),
  map: (_response, { characterId, labelId }): DeletedMailLabelResult => ({ characterId, labelId }),
  name: 'mail-delete-label-core',
  operation: 'mail-delete-label',
})

export const mailReadScope = mailHeadersRead.requiredScope
export const mailSendScope = mailSendMutation.requiredScope
export const mailOrganizeScope = mailCreateLabelMutation.requiredScope
export const mailSearchScope = characterSearchRead.requiredScope
export const mailCspaScope = characterCspaChargeRead.requiredScope

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

export class MailCspaRejectedError extends Error {
  constructor() {
    super('EVE rejected the recipient charge check')
    this.name = 'MailCspaRejectedError'
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
  subjectLifecycleId: string,
): Promise<MailHeaderPage> {
  const labels = normalizeLabelFilter(options.labels)
  const lastMailId = options.lastMailId ?? null
  try {
    const { data, ...metadata } = await mailHeadersRead.execute({
      characterId,
      labels,
      lastMailId,
      subjectLifecycleId,
    })
    return { characterId, ...data, ...metadata }
  } catch (error) {
    throwMailReadError(error)
  }
}

export async function getMailDetail(
  characterId: number,
  mailId: number,
  subjectLifecycleId: string,
): Promise<MailDetail> {
  try {
    const { data, ...metadata } = await mailDetailRead.execute({
      characterId,
      mailId,
      subjectLifecycleId,
    })
    return { characterId, ...data, ...metadata }
  } catch (error) {
    throwMailReadError(error, true)
  }
}

export async function getMailLabels(
  characterId: number,
  subjectLifecycleId: string,
): Promise<MailLabels> {
  try {
    const { data, ...metadata } = await mailLabelsRead.execute({ characterId, subjectLifecycleId })
    return { characterId, ...data, ...metadata }
  } catch (error) {
    throwMailReadError(error)
  }
}

export async function getMailingLists(
  characterId: number,
  subjectLifecycleId: string,
): Promise<MailingLists> {
  try {
    const { data, ...metadata } = await loadMailingLists(characterId, subjectLifecycleId)
    return { characterId, mailingLists: data, ...metadata }
  } catch (error) {
    throwMailReadError(error)
  }
}

export async function resolveMailRecipients(
  names: readonly string[],
): Promise<MailRecipientResolutionResult> {
  const resolved = await resolveUniverseIds(names)
  return {
    recipients: resolved.flatMap((entry) =>
      isUniversePartyType(entry.category)
        ? [{ id: entry.id, name: entry.name, type: entry.category }]
        : [],
    ),
  }
}

export async function searchMailRecipients(
  characterId: number,
  search: string,
  subjectLifecycleId: string,
): Promise<MailRecipientSearchResult> {
  try {
    const { data, ...metadata } = await characterSearchRead.execute({
      characterId,
      search,
      subjectLifecycleId,
    })
    return { characterId, recipients: data, ...metadata }
  } catch (error) {
    throwMailReadError(error)
  }
}

export async function calculateMailCspaCharge(
  characterId: number,
  characterIds: readonly number[],
  subjectLifecycleId: string,
): Promise<MailCspaChargeResult> {
  try {
    const response = await characterCspaChargeRead.execute({
      characterId,
      characterIds,
      subjectLifecycleId,
    })
    return { characterId, cost: response.data }
  } catch (error) {
    throwMailMutationError(error, 'cspa')
  }
}

export async function sendMail(
  characterId: number,
  input: SendMailInput,
  subjectLifecycleId: string,
): Promise<SentMailResult> {
  try {
    return await mailSendMutation.execute({ characterId, input, subjectLifecycleId })
  } catch (error) {
    throwMailMutationError(error, 'send')
  }
}

export async function createMailLabel(
  characterId: number,
  input: CreateMailLabelInput,
  subjectLifecycleId: string,
): Promise<CreatedMailLabelResult> {
  try {
    return await mailCreateLabelMutation.execute({ characterId, input, subjectLifecycleId })
  } catch (error) {
    throwMailMutationError(error, 'organize')
  }
}

export async function updateMail(
  characterId: number,
  mailId: number,
  input: UpdateMailInput,
  subjectLifecycleId: string,
): Promise<UpdatedMailResult> {
  try {
    return await mailUpdateMutation.execute({ characterId, input, mailId, subjectLifecycleId })
  } catch (error) {
    throwMailMutationError(error, 'organize')
  }
}

export async function deleteMail(
  characterId: number,
  mailId: number,
  subjectLifecycleId: string,
): Promise<DeletedMailResult> {
  try {
    return await mailDeleteMutation.execute({ characterId, mailId, subjectLifecycleId })
  } catch (error) {
    if (getEsiFailureStatus(error) === 404) {
      return { characterId, mailId }
    }
    throwMailMutationError(error, 'organize')
  }
}

export async function deleteMailLabel(
  characterId: number,
  labelId: number,
  subjectLifecycleId: string,
): Promise<DeletedMailLabelResult> {
  try {
    return await mailDeleteLabelMutation.execute({ characterId, labelId, subjectLifecycleId })
  } catch (error) {
    if (getEsiFailureStatus(error) === 404) {
      return { characterId, labelId }
    }
    throwMailMutationError(error, 'organize')
  }
}

async function mapMailHeaders(
  characterId: number,
  subjectLifecycleId: string,
  response: GetCharactersCharacterIdMailResponse,
) {
  const headers = response.map((header) => {
    if (header.mail_id === undefined) {
      throw new InvalidMailHeaderError()
    }
    return header as typeof header & { mail_id: number }
  })
  const parties = await enrichParties(characterId, subjectLifecycleId, headers)
  return {
    messages: headers.map((header) => ({
      isRead: header.is_read ?? null,
      labelIds: header.labels ?? [],
      mailId: header.mail_id,
      recipients: recipientParties(header.recipients, parties),
      sender: senderParty(header.from, parties),
      sentAt: header.timestamp ?? null,
      subject: header.subject ?? null,
    })),
    nextLastMailId: headers.length === 50 ? headers.at(-1)!.mail_id : null,
  }
}

async function mapMailDetail(
  characterId: number,
  subjectLifecycleId: string,
  mailId: number,
  response: GetCharactersCharacterIdMailMailIdResponse,
) {
  const parties = await enrichParties(characterId, subjectLifecycleId, [response])
  return {
    body: sanitizeMailBody(response.body),
    isRead: response.read ?? null,
    labelIds: response.labels ?? [],
    mailId,
    recipients: recipientParties(response.recipients, parties),
    sender: senderParty(response.from, parties),
    sentAt: response.timestamp ?? null,
    subject: response.subject ?? null,
  }
}

async function mapMailRecipientSearch(response: GetCharactersCharacterIdSearchResponse) {
  const matchGroups = [
    { ids: response.alliance ?? [], type: 'alliance' as const },
    { ids: response.character ?? [], type: 'character' as const },
    { ids: response.corporation ?? [], type: 'corporation' as const },
  ]
  const matches: Array<Pick<MailRecipient, 'id' | 'type'>> = []
  const seen = new Set<string>()
  const maximumGroupLength = Math.max(...matchGroups.map((group) => group.ids.length))
  for (let index = 0; index < maximumGroupLength; index += 1) {
    for (const group of matchGroups) {
      const id = group.ids[index]
      if (id === undefined) {
        continue
      }
      const key = `${group.type}:${id}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      matches.push({ id, type: group.type })
      if (matches.length === maximumMailRecipientSearchResults) {
        break
      }
    }
    if (matches.length === maximumMailRecipientSearchResults) {
      break
    }
  }
  const names = await resolveUniverseNames(matches.map((match) => match.id))
  return matches.flatMap((match) => {
    const resolved = names.get(match.id)
    return resolved?.category === match.type
      ? [{ id: match.id, name: resolved.name, type: match.type }]
      : []
  })
}

function normalizeLabelFilter(labels: readonly number[] | null | undefined) {
  if (!labels?.length) {
    return null
  }
  return [...new Set(labels)].toSorted((left, right) => left - right)
}

async function loadMailingLists(characterId: number, subjectLifecycleId: string) {
  return mailListsRead.execute({ characterId, subjectLifecycleId })
}

async function enrichParties(
  characterId: number,
  subjectLifecycleId: string,
  records: readonly EsiMailParties[],
) {
  const universeIds = new Set<number>()
  const mailingListIds = new Set<number>()
  for (const record of records) {
    if (record.from !== undefined) {
      universeIds.add(record.from)
    }
    for (const recipient of record.recipients ?? []) {
      if (recipient.recipient_type === 'mailing_list') {
        mailingListIds.add(recipient.recipient_id)
      } else {
        universeIds.add(recipient.recipient_id)
      }
    }
  }

  const [universeNames, mailingListNames] = await Promise.all([
    resolveNamesBestEffort([...universeIds]),
    resolveMailingListNamesBestEffort(characterId, subjectLifecycleId, mailingListIds.size > 0),
  ])
  return { mailingListNames, universeNames }
}

async function resolveNamesBestEffort(ids: number[]) {
  if (ids.length === 0) {
    return new Map<number, UniverseName>()
  }
  try {
    return await resolveUniverseNames(ids)
  } catch {
    return new Map<number, UniverseName>()
  }
}

async function resolveMailingListNamesBestEffort(
  characterId: number,
  subjectLifecycleId: string,
  needed: boolean,
) {
  if (!needed) {
    return new Map<number, string>()
  }
  try {
    const result = await loadMailingLists(characterId, subjectLifecycleId)
    return new Map(result.data.map((list) => [list.mailingListId, list.name]))
  } catch {
    return new Map<number, string>()
  }
}

function throwMailReadError(error: unknown, detail = false): never {
  preserveSharedError(error)
  const status = getEsiFailureStatus(error)
  if (status === 401 || status === 403) {
    throw new MailAuthorizationError(status)
  }
  if (detail && status === 404) {
    throw new MailNotFoundError()
  }
  throw new MailUnavailableError()
}

function throwMailMutationError(error: unknown, kind: 'cspa' | 'send' | 'organize'): never {
  preserveSharedError(error)
  const status = getEsiFailureStatus(error)
  if (status === 401 || status === 403) {
    throw new MailAuthorizationError(status)
  }
  if (kind === 'send' && isAmbiguousSendFailure(error)) {
    throw new MailDeliveryUnknownError()
  }
  if (status !== undefined && status >= 400 && status < 500) {
    if (kind === 'send') {
      throw new MailRejectedError()
    }
    if (kind === 'cspa') {
      throw new MailCspaRejectedError()
    }
    throw new MailMutationRejectedError()
  }
  throw new MailUnavailableError()
}

function preserveSharedError(error: unknown): void {
  if (
    error instanceof ScopeRequiredError ||
    error instanceof TokenRefreshUnavailableError ||
    error instanceof EsiQuotaError
  ) {
    throw error
  }
}

function isAmbiguousSendFailure(error: unknown) {
  return (
    isEsiMutationOutcomeUnknown(error) ||
    (error instanceof Error && error.name === 'EsiResourceRevisionUnavailableError')
  )
}
