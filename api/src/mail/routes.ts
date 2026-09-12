import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { env } from '../env.js'
import { getEsiMaximumBatchSize } from '../esi-gateway/catalog-interface.js'
import { EsiQuotaError } from '../esi-gateway/failures.js'
import { loadSession } from '../middleware/auth-session.js'
import type { OwnedCharacterEnv } from '../middleware/owned-character.js'
import { characterIdParams, loadOwnedCharacter } from '../middleware/owned-character.js'
import { ScopeRequiredError, TokenRefreshUnavailableError } from '../auth/token-errors.js'
import { privateNoStore } from '../http/private-response.js'
import { zValidator } from '../http/validation.js'
import {
  calculateMailCspaCharge,
  createMailLabel,
  deleteMail,
  deleteMailLabel,
  getMailDetail,
  getMailingLists,
  getMailLabels,
  listMailHeaders,
  mailCspaScope,
  mailLabelColors,
  mailOrganizeScope,
  mailReadScope,
  mailSearchScope,
  mailSendScope,
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
} from './mailbox.js'

const positiveIntegerString = (name: string) =>
  z
    .string()
    .regex(/^[1-9]\d*$/, `${name} must be a positive integer.`)
    .transform(Number)
    .pipe(z.number().int().positive(`${name} must be a positive integer.`))

const positiveSafeInteger = z.number().int().positive()
const uniqueLabelIds = z
  .array(positiveSafeInteger)
  .max(25)
  .superRefine((labels, context) => {
    if (new Set(labels).size !== labels.length)
      context.addIssue({ code: 'custom', message: 'Label IDs must be unique.' })
  })

const mailIdParams = characterIdParams.extend({ mailId: positiveIntegerString('Mail ID') })
const labelIdParams = characterIdParams.extend({ labelId: positiveIntegerString('Label ID') })
const labelsQuery = z
  .union([
    positiveIntegerString('Label ID'),
    z.array(positiveIntegerString('Label ID')).min(1).max(25),
  ])
  .transform((labels) => (Array.isArray(labels) ? labels : [labels]))
  .superRefine((labels, context) => {
    if (new Set(labels).size !== labels.length)
      context.addIssue({ code: 'custom', message: 'Label IDs must be unique.' })
  })
  .transform((labels) => labels.toSorted((left, right) => left - right))
const mailQuery = z
  .object({
    labels: labelsQuery.optional(),
    lastMailId: positiveIntegerString('Last mail ID').optional(),
  })
  .strict()
const sendMailBody = z
  .object({
    recipients: z
      .array(
        z
          .object({
            id: positiveSafeInteger,
            type: z.enum(['alliance', 'character', 'corporation', 'mailing_list']),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    subject: z.string().max(1_000),
    body: z.string().max(10_000),
    approvedCost: z.number().int().nonnegative().default(0),
  })
  .strict()
const createLabelBody = z
  .object({
    name: z.string().min(1).max(40),
    color: z.enum(mailLabelColors).optional(),
  })
  .strict()
const updateMailBody = z
  .object({
    read: z.boolean().optional(),
    labels: uniqueLabelIds.optional(),
  })
  .strict()
  .refine((value) => value.read !== undefined || value.labels !== undefined, {
    message: 'At least one of read or labels is required.',
  })
const resolveRecipientsBody = z
  .object({ names: z.array(z.string().trim().min(1).max(100)).min(1).max(500) })
  .strict()
const searchRecipientsQuery = z.object({ search: z.string().trim().min(3).max(256) }).strict()
const maximumCspaRecipients = getEsiMaximumBatchSize('character-cspa-charge')
const cspaChargeBody = z
  .object({
    characterIds: z
      .array(positiveSafeInteger)
      .min(1)
      .max(maximumCspaRecipients)
      .superRefine((characterIds, context) => {
        if (new Set(characterIds).size !== characterIds.length)
          context.addIssue({ code: 'custom', message: 'Character IDs must be unique.' })
      }),
  })
  .strict()

export const mailRoutes = new Hono<OwnedCharacterEnv>()
  .get(
    '/:characterId/mail',
    privateNoStore,
    zValidator('param', characterIdParams),
    zValidator('query', mailQuery),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      const query = context.req.valid('query')
      try {
        return context.json(
          await listMailHeaders(
            characterId,
            {
              labels: query.labels,
              lastMailId: query.lastMailId,
            },
            subjectLifecycleId,
          ),
          200,
        )
      } catch (error) {
        return mailError(context, error, characterId, mailReadScope)
      }
    },
  )
  .post(
    '/:characterId/mail',
    privateNoStore,
    zValidator('param', characterIdParams),
    zValidator('json', sendMailBody),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      try {
        return context.json(
          await sendMail(characterId, context.req.valid('json'), subjectLifecycleId),
          201,
        )
      } catch (error) {
        return mailError(context, error, characterId, mailSendScope)
      }
    },
  )
  .post(
    '/:characterId/mail/recipients/resolve',
    privateNoStore,
    zValidator('param', characterIdParams),
    zValidator('json', resolveRecipientsBody),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      try {
        return context.json(await resolveMailRecipients(context.req.valid('json').names), 200)
      } catch (error) {
        return mailError(context, error, context.var.ownedCharacter.characterId, null)
      }
    },
  )
  .get(
    '/:characterId/mail/recipients/search',
    privateNoStore,
    zValidator('param', characterIdParams),
    zValidator('query', searchRecipientsQuery),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      try {
        return context.json(
          await searchMailRecipients(
            characterId,
            context.req.valid('query').search,
            subjectLifecycleId,
          ),
          200,
        )
      } catch (error) {
        return mailError(context, error, characterId, mailSearchScope)
      }
    },
  )
  .post(
    '/:characterId/mail/cspa',
    privateNoStore,
    zValidator('param', characterIdParams),
    zValidator('json', cspaChargeBody),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      try {
        return context.json(
          await calculateMailCspaCharge(
            characterId,
            context.req.valid('json').characterIds,
            subjectLifecycleId,
          ),
          200,
        )
      } catch (error) {
        return mailError(context, error, characterId, mailCspaScope)
      }
    },
  )
  .get(
    '/:characterId/mail/labels',
    privateNoStore,
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      try {
        return context.json(await getMailLabels(characterId, subjectLifecycleId), 200)
      } catch (error) {
        return mailError(context, error, characterId, mailReadScope)
      }
    },
  )
  .post(
    '/:characterId/mail/labels',
    privateNoStore,
    zValidator('param', characterIdParams),
    zValidator('json', createLabelBody),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      try {
        return context.json(
          await createMailLabel(characterId, context.req.valid('json'), subjectLifecycleId),
          201,
        )
      } catch (error) {
        return mailError(context, error, characterId, mailOrganizeScope)
      }
    },
  )
  .delete(
    '/:characterId/mail/labels/:labelId',
    privateNoStore,
    zValidator('param', labelIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      try {
        await deleteMailLabel(characterId, context.req.valid('param').labelId, subjectLifecycleId)
        return context.body(null, 204)
      } catch (error) {
        return mailError(context, error, characterId, mailOrganizeScope)
      }
    },
  )
  .get(
    '/:characterId/mail/lists',
    privateNoStore,
    zValidator('param', characterIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      try {
        return context.json(await getMailingLists(characterId, subjectLifecycleId), 200)
      } catch (error) {
        return mailError(context, error, characterId, mailReadScope)
      }
    },
  )
  .get(
    '/:characterId/mail/:mailId',
    privateNoStore,
    zValidator('param', mailIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      try {
        return context.json(
          await getMailDetail(characterId, context.req.valid('param').mailId, subjectLifecycleId),
          200,
        )
      } catch (error) {
        return mailError(context, error, characterId, mailReadScope, true)
      }
    },
  )
  .put(
    '/:characterId/mail/:mailId',
    privateNoStore,
    zValidator('param', mailIdParams),
    zValidator('json', updateMailBody),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      try {
        await updateMail(
          characterId,
          context.req.valid('param').mailId,
          context.req.valid('json'),
          subjectLifecycleId,
        )
        return context.body(null, 204)
      } catch (error) {
        return mailError(context, error, characterId, mailOrganizeScope)
      }
    },
  )
  .delete(
    '/:characterId/mail/:mailId',
    privateNoStore,
    zValidator('param', mailIdParams),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const { characterId, subjectLifecycleId } = context.var.ownedCharacter
      try {
        await deleteMail(characterId, context.req.valid('param').mailId, subjectLifecycleId)
        return context.body(null, 204)
      } catch (error) {
        return mailError(context, error, characterId, mailOrganizeScope)
      }
    },
  )

function mailError(
  context: Context,
  error: unknown,
  characterId: number,
  requiredScope: string | null,
  allowNotFound = false,
) {
  if (requiredScope && error instanceof ScopeRequiredError) {
    return context.json(
      {
        code: 'EVE_SCOPE_REQUIRED',
        message: scopeMessage(requiredScope),
        requiredScope,
        authorizeUrl: reauthorizationUrl(characterId),
      },
      403,
    )
  }
  if (requiredScope && error instanceof MailAuthorizationError) {
    return context.json(
      {
        code: 'EVE_REAUTH_REQUIRED',
        message: 'EVE authorization is no longer valid.',
        requiredScope,
        authorizeUrl: reauthorizationUrl(characterId),
      },
      403,
    )
  }
  if (error instanceof EsiQuotaError) {
    context.header('Retry-After', String(error.retryAfterSeconds))
    return context.json(
      {
        code: 'ESI_COOLDOWN',
        message: 'EVE Online ESI is temporarily rate limited.',
        retryAfterSeconds: error.retryAfterSeconds,
      },
      429,
    )
  }
  if (error instanceof TokenRefreshUnavailableError) {
    return context.json(
      {
        code: 'EVE_TOKEN_REFRESH_UNAVAILABLE',
        message: 'EVE token refresh is temporarily unavailable. Try again shortly.',
      },
      503,
    )
  }
  if (allowNotFound && error instanceof MailNotFoundError) {
    return context.json({ code: 'MAIL_NOT_FOUND', message: 'Mail not found.' }, 404)
  }
  if (error instanceof MailRejectedError) {
    return context.json({ code: 'MAIL_REJECTED', message: 'EVE rejected the mail.' }, 422)
  }
  if (error instanceof MailCspaRejectedError) {
    return context.json(
      { code: 'MAIL_CSPA_REJECTED', message: 'EVE rejected the recipient charge check.' },
      422,
    )
  }
  if (error instanceof MailDeliveryUnknownError) {
    return context.json(
      {
        code: 'MAIL_DELIVERY_UNKNOWN',
        message: 'Mail delivery could not be confirmed. Inspect sent mail before sending again.',
      },
      502,
    )
  }
  if (error instanceof MailMutationRejectedError) {
    return context.json(
      { code: 'MAIL_MUTATION_REJECTED', message: 'EVE rejected the mail change.' },
      409,
    )
  }
  return context.json(
    { code: 'ESI_UNAVAILABLE', message: 'EVE mail is temporarily unavailable.' },
    502,
  )
}

function scopeMessage(scope: string) {
  if (scope === mailSendScope) return 'Authorize sending mail for this character.'
  if (scope === mailOrganizeScope) return 'Authorize mail organization for this character.'
  if (scope === mailSearchScope) return 'Authorize recipient search for this character.'
  if (scope === mailCspaScope) return 'Authorize mail charge checks for this character.'
  return 'Authorize mail access for this character.'
}

function reauthorizationUrl(characterId: number) {
  const url = new URL(`/auth/eve/reauthorize/${characterId}`, env.EVE_CALLBACK_URL)
  url.searchParams.set('returnTo', `/characters/${characterId}/mail`)
  return url.toString()
}
