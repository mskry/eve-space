import {
  projectMailRecipients,
  projectMailSender,
  sanitizeMailBody,
  type MailPartyNames,
  type MailRecipientSource,
} from '@eve-space/core-eve-projections/mail'
import type {
  PlatformBoundedCollectionResourceImplementation,
  PlatformCharacterResourceSubject,
  PlatformResourceRootProtocol,
} from '@eve-space/platform-module-contract/resources'
import type { PlatformCoreEsiOperationProtocol } from '@eve-space/platform-module-server'
import { z } from 'zod'
import {
  materializeEvidenceObservation,
  startEvidenceCollection,
  type EvidenceCollectionContext,
  type EvidenceObservation,
  type IntentionalEvidence,
  type StagedEvidenceRecord,
} from './evidence-collection.js'
import { maintainEvidence } from './evidence-maintenance.js'
import type {
  EvidenceCollectionPersistence,
  EvidenceMaintenancePersistence,
  EvidenceMaterializationPersistence,
} from './persistence.js'
import { resolveUniverseNamesBestEffort } from './universe-name-resolution.js'

const mailPageSize = 50
const recipientSchema = z.object({
  recipient_id: z.number().int().positive(),
  recipient_type: z.enum(['alliance', 'character', 'corporation', 'mailing_list']),
})
const mailHeaderSchema = z.object({
  from: z.number().int().positive().optional(),
  is_read: z.boolean().optional(),
  labels: z.array(z.number().int()).max(1000).optional(),
  mail_id: z.number().int().positive(),
  recipients: z.array(recipientSchema).max(1000).optional(),
  subject: z.string().max(100_000).optional(),
  timestamp: z.iso.datetime({ offset: true }),
})
const mailHeadersSchema = z.array(mailHeaderSchema).max(mailPageSize)
const mailDetailSchema = z.object({
  body: z.string().optional(),
  from: z.number().int().positive().optional(),
  labels: z.array(z.number().int()).max(1000).optional(),
  read: z.boolean().optional(),
  recipients: z.array(recipientSchema).max(1000).optional(),
  subject: z.string().max(100_000).optional(),
  timestamp: z.iso.datetime({ offset: true }).optional(),
})
const mailingListsSchema = z.array(
  z.object({ mailing_list_id: z.number().int().positive(), name: z.string().max(500) }),
)
const headerCheckpointSchema = z.object({
  lastMailId: z.number().int().positive().nullable().default(null),
})
const detailCheckpointSchema = z.object({
  lastMailId: z.number().int().positive().nullable().default(null),
})

type MailHeader = z.infer<typeof mailHeaderSchema>
type MailDetail = z.infer<typeof mailDetailSchema>
type MailHeaderObservation = Extract<EvidenceObservation, { resourceId: 'mail-headers' }>
type MailDetailObservation = Extract<EvidenceObservation, { resourceId: 'mail-details' }>
type MailPartyProtocol = PlatformCoreEsiOperationProtocol<'mail-lists' | 'universe-resolve-names'>
type MailHeaderProtocol = PlatformCoreEsiOperationProtocol<
  'mail-headers' | 'mail-lists' | 'universe-resolve-names'
>
type MailDetailProtocol = PlatformCoreEsiOperationProtocol<
  'mail-headers' | 'mail-message' | 'mail-lists' | 'universe-resolve-names'
>
type MailResource<
  Protocol extends PlatformResourceRootProtocol<'mail-headers'>,
  Data,
> = PlatformBoundedCollectionResourceImplementation<
  'mail-headers',
  Protocol,
  Data,
  string,
  unknown,
  PlatformCharacterResourceSubject,
  readonly [],
  EvidenceCollectionPersistence,
  EvidenceMaterializationPersistence,
  EvidenceMaintenancePersistence
>

export const mailHeadersResource: MailResource<MailHeaderProtocol, MailHeaderObservation> = {
  async collect(context) {
    const collection = await startEvidenceCollection(
      { sectionId: 'mail', resourceId: 'mail-headers' },
      context,
    )
    const checkpoint = headerCheckpointSchema.parse(collection.checkpoint)
    const result = await context.operations['mail-headers']({
      path: { character_id: context.subject.characterId },
      ...(checkpoint.lastMailId === null ? {} : { query: { last_mail_id: checkpoint.lastMailId } }),
    })
    const headers = mailHeadersSchema.parse(result.data)
    const parties = await resolveParties(headers, context)
    const nextLastMailId = headers.at(-1)?.mail_id ?? null
    if (
      headers.length === mailPageSize &&
      (nextLastMailId === null || nextLastMailId === checkpoint.lastMailId)
    ) {
      throw new Error('Mail header continuation did not advance')
    }
    const complete = headers.length < mailPageSize
    return {
      complete,
      data: {
        sectionId: 'mail',
        resourceId: 'mail-headers',
        observationId: collection.observationId,
        expectedRevision: collection.expectedRevision,
        checkpoint: {
          complete,
          lastMailId: complete ? checkpoint.lastMailId : nextLastMailId,
        },
        records: headers.map((header) => headerRecord(header, parties, result.validatedAt)),
      },
    }
  },
  maintain(context) {
    return maintainEvidence('mail-headers', context, false)
  },
  materialize(context) {
    return materializeEvidenceObservation(context)
  },
  mode: 'bounded-collection',
  operation: 'mail-headers',
}

export const mailDetailsResource: MailResource<MailDetailProtocol, MailDetailObservation> = {
  async collect(context) {
    const collection = await startEvidenceCollection(
      { sectionId: 'mail', resourceId: 'mail-details' },
      context,
    )
    const checkpoint = detailCheckpointSchema.parse(collection.checkpoint)
    const headerResult = await context.operations['mail-headers']({
      path: { character_id: context.subject.characterId },
      ...(checkpoint.lastMailId === null ? {} : { query: { last_mail_id: checkpoint.lastMailId } }),
    })
    const headers = mailHeadersSchema.parse(headerResult.data)
    const detailLimit = Math.max(0, context.requestBudget - 3)
    if (detailLimit === 0 && headers.length > 0) {
      throw new Error('Mail detail request budget cannot advance collection')
    }
    const selected = headers.slice(0, detailLimit)
    const details = await Promise.all(
      selected.map(async (header) => {
        const result = await context.operations['mail-message']({
          path: { character_id: context.subject.characterId, mail_id: header.mail_id },
        })
        return {
          header,
          detail: mailDetailSchema.parse(result.data),
          validatedAt: result.validatedAt,
        }
      }),
    )
    const parties = await resolveParties(
      details.map(({ detail }) => detail),
      context,
    )
    const consumedPage = selected.length >= headers.length
    const complete = consumedPage && headers.length < mailPageSize
    const nextLastMailId = selected.at(-1)?.mail_id ?? null
    if (!complete && (nextLastMailId === null || nextLastMailId === checkpoint.lastMailId)) {
      throw new Error('Mail detail continuation did not advance')
    }
    return {
      complete,
      data: {
        sectionId: 'mail',
        resourceId: 'mail-details',
        observationId: collection.observationId,
        expectedRevision: collection.expectedRevision,
        checkpoint: complete
          ? { complete: true, lastMailId: checkpoint.lastMailId }
          : { complete: false, lastMailId: nextLastMailId },
        records: details.map(({ header, detail, validatedAt }) =>
          detailRecord(header.mail_id, detail, parties, validatedAt),
        ),
      },
    }
  },
  maintain(context) {
    return maintainEvidence('mail-contents', context, false)
  },
  materialize(context) {
    return materializeEvidenceObservation(context)
  },
  mode: 'bounded-collection',
  operation: 'mail-headers',
}

function headerRecord(
  header: MailHeader,
  parties: MailPartyNames,
  validatedAt: string,
): StagedEvidenceRecord<'mail-header'> {
  return {
    evidence: mailEvidence(header.mail_id, header, parties, header.is_read ?? null, null),
    recordKind: 'mail-header',
    sourceId: String(header.mail_id),
    sourceTimestamp: header.timestamp,
    validatedAt,
  }
}

function detailRecord(
  mailId: number,
  detail: MailDetail,
  parties: MailPartyNames,
  validatedAt: string,
): StagedEvidenceRecord<'mail-content'> {
  return {
    evidence: mailEvidence(
      mailId,
      detail,
      parties,
      detail.read ?? null,
      sanitizeMailBody(detail.body)?.slice(0, 100_000) ?? null,
    ),
    recordKind: 'mail-content',
    sourceId: String(mailId),
    sourceTimestamp: detail.timestamp ?? null,
    validatedAt,
  }
}

function mailEvidence(
  mailId: number,
  mail: {
    readonly from?: number
    readonly labels?: readonly number[]
    readonly recipients?: readonly MailRecipientSource[]
    readonly subject?: string
    readonly timestamp?: string
  },
  parties: MailPartyNames,
  isRead: boolean | null,
  body: string | null,
): IntentionalEvidence {
  const sender = projectMailSender(mail.from, parties)
  const recipients = projectMailRecipients(mail.recipients, parties)
  return {
    body,
    isRead,
    labelIds: [...(mail.labels ?? [])],
    mailId,
    recipientIds: recipients.map((recipient) => recipient.id),
    recipientNames: recipients.map((recipient) => recipient.name),
    recipientTypes: recipients.map((recipient) => recipient.type),
    senderId: sender?.id ?? null,
    senderName: sender?.name ?? null,
    senderType: sender?.type ?? null,
    sentAt: mail.timestamp ?? null,
    subject: mail.subject ?? null,
  }
}

async function resolveParties(
  records: readonly {
    readonly from?: number
    readonly recipients?: readonly MailRecipientSource[]
  }[],
  context: EvidenceCollectionContext<MailPartyProtocol>,
): Promise<MailPartyNames> {
  const universeIds = new Set<number>()
  let needsMailingLists = false
  for (const record of records) {
    if (record.from !== undefined) {
      universeIds.add(record.from)
    }
    for (const recipient of record.recipients ?? []) {
      if (recipient.recipient_type === 'mailing_list') {
        needsMailingLists = true
      } else {
        universeIds.add(recipient.recipient_id)
      }
    }
  }
  const [universeNames, listsResult] = await Promise.all([
    resolveUniverseNamesBestEffort([...universeIds], context),
    !needsMailingLists
      ? { data: [] }
      : context.operations['mail-lists']({
          path: { character_id: context.subject.characterId },
        }),
  ])
  return {
    mailingListNames: new Map(
      mailingListsSchema.parse(listsResult.data).map((list) => [list.mailing_list_id, list.name]),
    ),
    universeNames,
  }
}
