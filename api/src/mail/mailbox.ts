import { operationRegistry } from '@evespace/esi-client/operations'
import type {
  GetCharactersCharacterIdMailMailIdResponse,
  GetCharactersCharacterIdMailResponse,
  GetCharactersCharacterIdSearchResponse,
} from '@evespace/esi-client/types'
import { eveDescriptionToPlainText } from '../text/eve-description.js'
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
import { ScopeRequiredError, TokenRefreshUnavailableError } from '../auth/tokens.js'
import { resolveUniverseIds, resolveUniverseNames, type UniverseName } from '../universe/names.js'

type MailRecipientType = 'alliance' | 'character' | 'corporation' | 'mailing_list'
type MailPartyType = MailRecipientType | 'unknown'
const maximumMailRecipientSearchResults = 50
const mailSearchCategories = ['alliance', 'character', 'corporation'] as const

interface MailParty {
  id: number
  type: MailPartyType
  name: string | null
}

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

interface EsiMailRecipient {
  recipient_id: number
  recipient_type: MailRecipientType
}

interface EsiMailParties {
  from?: number
  recipients?: EsiMailRecipient[]
}

interface MailHeadersRepresentationInput {
  characterId: number
  subjectLifecycleId: string
  labels: number[] | null
  lastMailId: number | null
}

const mailHeadersRead = createCharacterEsiRead({
  operation: 'mail-headers',
  name: 'mail-headers-core',
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
})

interface MailDetailRepresentationInput {
  characterId: number
  subjectLifecycleId: string
  mailId: number
}

const mailDetailRead = createCharacterEsiRead({
  operation: 'mail-message',
  name: 'mail-message-core',
  descriptor: operationRegistry.GetCharactersCharacterIdMailMailId.transport,
  encodeRequest: (input: MailDetailRepresentationInput) => ({
    path: { character_id: input.characterId, mail_id: input.mailId },
  }),
  map: (response, input) =>
    mapMailDetail(input.characterId, input.subjectLifecycleId, input.mailId, response.data),
})

interface CharacterRepresentationInput {
  characterId: number
  subjectLifecycleId: string
}

const mailLabelsRead = createCharacterEsiRead({
  operation: 'mail-labels',
  name: 'mail-labels-core',
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
})

const mailListsRead = createCharacterEsiRead({
  operation: 'mail-lists',
  name: 'mail-lists-core',
  descriptor: operationRegistry.GetCharactersCharacterIdMailLists.transport,
  encodeRequest: (input: CharacterRepresentationInput) => ({
    path: { character_id: input.characterId },
  }),
  map: (response): MailingList[] =>
    response.data.map((list) => ({
      mailingListId: list.mailing_list_id,
      name: list.name,
    })),
})

interface CharacterSearchRepresentationInput {
  characterId: number
  search: string
  subjectLifecycleId: string
}

const characterSearchRead = createCharacterEsiRead({
  operation: 'character-search',
  name: 'character-search-mail',
  descriptor: operationRegistry.GetCharactersCharacterIdSearch.transport,
  encodeRequest: (input: CharacterSearchRepresentationInput) => ({
    path: { character_id: input.characterId },
    query: {
      categories: [...mailSearchCategories],
      search: input.search,
    },
  }),
  map: (response) => mapMailRecipientSearch(response.data),
})

interface CharacterCspaChargeRepresentationInput {
  characterId: number
  characterIds: readonly number[]
  subjectLifecycleId: string
}

const characterCspaChargeRead = createCharacterEsiRead({
  operation: 'character-cspa-charge',
  name: 'character-cspa-charge-mail',
  descriptor: operationRegistry.PostCharactersCharacterIdCspa.transport,
  encodeRequest: (input: CharacterCspaChargeRepresentationInput) => ({
    path: { character_id: input.characterId },
    body: [...input.characterIds],
  }),
  map: (response): number => response.data,
})

const mailSendMutation = createCharacterEsiMutation({
  operation: 'mail-send',
  name: 'mail-send-core',
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
})

interface MailCreateLabelRepresentationInput {
  characterId: number
  input: CreateMailLabelInput
  subjectLifecycleId: string
}

const mailCreateLabelMutation = createCharacterEsiMutation({
  operation: 'mail-create-label',
  name: 'mail-create-label-core',
  descriptor: operationRegistry.PostCharactersCharacterIdMailLabels.transport,
  encodeRequest: ({ characterId, input }: MailCreateLabelRepresentationInput) => ({
    path: { character_id: characterId },
    body: { name: input.name, ...(input.color ? { color: input.color } : {}) },
  }),
  map: ({ data }, { characterId }): CreatedMailLabelResult => ({
    characterId,
    labelId: data,
  }),
})

interface MailUpdateRepresentationInput {
  characterId: number
  mailId: number
  input: UpdateMailInput
  subjectLifecycleId: string
}

const mailUpdateMutation = createCharacterEsiMutation({
  operation: 'mail-update',
  name: 'mail-update-core',
  descriptor: operationRegistry.PutCharactersCharacterIdMailMailId.transport,
  encodeRequest: ({ characterId, mailId, input }: MailUpdateRepresentationInput) => ({
    path: { character_id: characterId, mail_id: mailId },
    body: {
      ...(input.labels === undefined ? {} : { labels: [...input.labels] }),
      ...(input.read === undefined ? {} : { read: input.read }),
    },
  }),
  map: (_response, { characterId, mailId }): UpdatedMailResult => ({ characterId, mailId }),
})

interface MailDeleteRepresentationInput {
  characterId: number
  mailId: number
  subjectLifecycleId: string
}

const mailDeleteMutation = createCharacterEsiMutation({
  operation: 'mail-delete',
  name: 'mail-delete-core',
  descriptor: operationRegistry.DeleteCharactersCharacterIdMailMailId.transport,
  encodeRequest: (input: MailDeleteRepresentationInput) => ({
    path: { character_id: input.characterId, mail_id: input.mailId },
  }),
  map: (_response, { characterId, mailId }): DeletedMailResult => ({ characterId, mailId }),
})

interface MailDeleteLabelRepresentationInput {
  characterId: number
  labelId: number
  subjectLifecycleId: string
}

const mailDeleteLabelMutation = createCharacterEsiMutation({
  operation: 'mail-delete-label',
  name: 'mail-delete-label-core',
  descriptor: operationRegistry.DeleteCharactersCharacterIdMailLabelsLabelId.transport,
  encodeRequest: (input: MailDeleteLabelRepresentationInput) => ({
    path: { character_id: input.characterId, label_id: input.labelId },
  }),
  map: (_response, { characterId, labelId }): DeletedMailLabelResult => ({ characterId, labelId }),
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
      subjectLifecycleId,
      labels,
      lastMailId,
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
      subjectLifecycleId,
      mailId,
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
        ? [{ id: entry.id, type: entry.category, name: entry.name }]
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
    return await mailUpdateMutation.execute({ characterId, mailId, input, subjectLifecycleId })
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
    if (getEsiFailureStatus(error) === 404) return { characterId, mailId }
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
    if (getEsiFailureStatus(error) === 404) return { characterId, labelId }
    throwMailMutationError(error, 'organize')
  }
}

async function mapMailHeaders(
  characterId: number,
  subjectLifecycleId: string,
  response: GetCharactersCharacterIdMailResponse,
) {
  const headers = response.map((header) => {
    if (header.mail_id === undefined) throw new InvalidMailHeaderError()
    return header as typeof header & { mail_id: number }
  })
  const parties = await enrichParties(characterId, subjectLifecycleId, headers)
  return {
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
    mailId,
    sender: senderParty(response.from, parties),
    recipients: recipientParties(response.recipients, parties),
    subject: response.subject ?? null,
    sentAt: response.timestamp ?? null,
    labelIds: response.labels ?? [],
    isRead: response.read ?? null,
    body: eveDescriptionToPlainText(response.body) ?? null,
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
      if (id === undefined) continue
      const key = `${group.type}:${id}`
      if (seen.has(key)) continue
      seen.add(key)
      matches.push({ id, type: group.type })
      if (matches.length === maximumMailRecipientSearchResults) break
    }
    if (matches.length === maximumMailRecipientSearchResults) break
  }
  const names = await resolveUniverseNames(matches.map((match) => match.id))
  return matches.flatMap((match) => {
    const resolved = names.get(match.id)
    return resolved?.category === match.type
      ? [{ id: match.id, type: match.type, name: resolved.name }]
      : []
  })
}

function normalizeLabelFilter(labels: readonly number[] | null | undefined) {
  if (!labels?.length) return null
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
    if (record.from !== undefined) universeIds.add(record.from)
    for (const recipient of record.recipients ?? []) {
      if (recipient.recipient_type === 'mailing_list') mailingListIds.add(recipient.recipient_id)
      else universeIds.add(recipient.recipient_id)
    }
  }

  const [universeNames, mailingListNames] = await Promise.all([
    resolveNamesBestEffort([...universeIds]),
    resolveMailingListNamesBestEffort(characterId, subjectLifecycleId, mailingListIds.size > 0),
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

async function resolveMailingListNamesBestEffort(
  characterId: number,
  subjectLifecycleId: string,
  needed: boolean,
) {
  if (!needed) return new Map<number, string>()
  try {
    const result = await loadMailingLists(characterId, subjectLifecycleId)
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
  return (recipients ?? []).map((recipient) => {
    let name = parties.mailingListNames.get(recipient.recipient_id) ?? null
    if (recipient.recipient_type !== 'mailing_list') {
      const universeParty = parties.universeNames.get(recipient.recipient_id)
      name = universeParty?.category === recipient.recipient_type ? universeParty.name : null
    }
    return { id: recipient.recipient_id, type: recipient.recipient_type, name }
  })
}

function isUniversePartyType(value: string): value is Exclude<MailRecipientType, 'mailing_list'> {
  return value === 'alliance' || value === 'character' || value === 'corporation'
}

function throwMailReadError(error: unknown, detail = false): never {
  preserveSharedError(error)
  const status = getEsiFailureStatus(error)
  if (status === 401 || status === 403) throw new MailAuthorizationError(status)
  if (detail && status === 404) throw new MailNotFoundError()
  throw new MailUnavailableError()
}

function throwMailMutationError(error: unknown, kind: 'cspa' | 'send' | 'organize'): never {
  preserveSharedError(error)
  const status = getEsiFailureStatus(error)
  if (status === 401 || status === 403) throw new MailAuthorizationError(status)
  if (kind === 'send' && isAmbiguousSendFailure(error)) throw new MailDeliveryUnknownError()
  if (status !== undefined && status >= 400 && status < 500) {
    if (kind === 'send') throw new MailRejectedError()
    if (kind === 'cspa') throw new MailCspaRejectedError()
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
  return (
    isEsiMutationOutcomeUnknown(error) ||
    (error instanceof Error && error.name === 'EsiResourceRevisionUnavailableError')
  )
}
