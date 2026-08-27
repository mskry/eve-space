import { Hono } from 'hono'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import { env } from '../env.js'
import { EsiQuotaError } from '../esi-resilience/cooldowns.js'
import { loadSession } from '../middleware/auth-session.js'
import type { OwnedCharacterEnv } from '../middleware/owned-character.js'
import { characterIdParams, loadOwnedCharacter } from '../middleware/owned-character.js'
import { ScopeRequiredError, TokenRefreshUnavailableError } from '../token-service.js'
import { zValidator } from '../validation.js'
import {
  createMailLabel,
  deleteMail,
  deleteMailLabel,
  getMailDetail,
  getMailingLists,
  getMailLabels,
  listMailHeaders,
  mailLabelColors,
  MailAuthorizationError,
  MailDeliveryUnknownError,
  MailMutationRejectedError,
  MailNotFoundError,
  MailRejectedError,
  sendMail,
  updateMail,
} from './service.js'

const readMailScope = 'esi-mail.read_mail.v1'
const sendMailScope = 'esi-mail.send_mail.v1'
const organizeMailScope = 'esi-mail.organize_mail.v1'

const positiveIntegerString = (name: string) =>
  z
    .string()
    .regex(/^[1-9]\d*$/, `${name} must be a positive integer.`)
    .transform(Number)
    .pipe(z.number().int().positive().safe(`${name} must be a positive integer.`))

const positiveSafeInteger = z.number().int().positive().safe()
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
    approvedCost: z.number().int().nonnegative().safe().default(0),
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

const privateNoStore = createMiddleware(async (context, next) => {
  context.header('Cache-Control', 'private, no-store')
  context.header('Vary', 'Cookie')
  await next()
})

export const mailRoutes = new Hono<OwnedCharacterEnv>()
  .get(
    '/:characterId/mail',
    privateNoStore,
    zValidator('param', characterIdParams),
    zValidator('query', mailQuery),
    loadSession,
    loadOwnedCharacter,
    async (context) => {
      const characterId = context.var.ownedCharacter.characterId
      const query = context.req.valid('query')
      try {
        return context.json(
          await listMailHeaders(characterId, {
            labels: query.labels,
            lastMailId: query.lastMailId,
          }),
          200,
        )
      } catch (error) {
        return mailError(context, error, characterId, readMailScope)
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
      const characterId = context.var.ownedCharacter.characterId
      try {
        return context.json(await sendMail(characterId, context.req.valid('json')), 201)
      } catch (error) {
        return mailError(context, error, characterId, sendMailScope)
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
      const characterId = context.var.ownedCharacter.characterId
      try {
        return context.json(await getMailLabels(characterId), 200)
      } catch (error) {
        return mailError(context, error, characterId, readMailScope)
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
      const characterId = context.var.ownedCharacter.characterId
      try {
        return context.json(await createMailLabel(characterId, context.req.valid('json')), 201)
      } catch (error) {
        return mailError(context, error, characterId, organizeMailScope)
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
      const characterId = context.var.ownedCharacter.characterId
      try {
        await deleteMailLabel(characterId, context.req.valid('param').labelId)
        return context.body(null, 204)
      } catch (error) {
        return mailError(context, error, characterId, organizeMailScope)
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
      const characterId = context.var.ownedCharacter.characterId
      try {
        return context.json(await getMailingLists(characterId), 200)
      } catch (error) {
        return mailError(context, error, characterId, readMailScope)
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
      const characterId = context.var.ownedCharacter.characterId
      try {
        return context.json(
          await getMailDetail(characterId, context.req.valid('param').mailId),
          200,
        )
      } catch (error) {
        return mailError(context, error, characterId, readMailScope, true)
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
      const characterId = context.var.ownedCharacter.characterId
      try {
        await updateMail(characterId, context.req.valid('param').mailId, context.req.valid('json'))
        return context.body(null, 204)
      } catch (error) {
        return mailError(context, error, characterId, organizeMailScope)
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
      const characterId = context.var.ownedCharacter.characterId
      try {
        await deleteMail(characterId, context.req.valid('param').mailId)
        return context.body(null, 204)
      } catch (error) {
        return mailError(context, error, characterId, organizeMailScope)
      }
    },
  )

function mailError(
  context: Context,
  error: unknown,
  characterId: number,
  requiredScope: string,
  allowNotFound = false,
) {
  if (error instanceof ScopeRequiredError) {
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
  if (error instanceof MailAuthorizationError) {
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
  if (scope === sendMailScope) return 'Authorize sending mail for this character.'
  if (scope === organizeMailScope) return 'Authorize mail organization for this character.'
  return 'Authorize mail access for this character.'
}

function reauthorizationUrl(characterId: number) {
  const url = new URL(`/auth/eve/reauthorize/${characterId}`, env.EVE_CALLBACK_URL)
  url.searchParams.set('returnTo', `/characters/${characterId}/mail`)
  return url.toString()
}
