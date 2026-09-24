import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { zValidator } from '../http/validation.js'
import type { OrganizationSessionEnv } from '../middleware/organization-session.js'
import { listCurrentOrganizationAuditHistory } from './audit-history.js'
import {
  approveOrganizationCharacterException,
  expireOrganizationCharacterException,
  listCurrentOrganizationCharacterExceptionCandidates,
  listCurrentOrganizationCharacterExceptions,
  OrganizationCharacterExceptionMutationError,
  revokeOrganizationCharacterException,
} from './exception-store.js'
import { requireOrganizationHr, requireTrustedOrigin } from './route-middleware.js'
import { listOrganizationRosterCoverage } from './roster-coverage.js'

const reasonSchema = z.string().trim().min(1, 'A reason is required.').max(2000)
const memberParamsSchema = z.object({ userId: z.uuid('Enter a valid user ID.') })
const characterExceptionParamsSchema = memberParamsSchema.extend({
  characterId: z.coerce.number().int().positive(),
})
const exceptionParamsSchema = z.object({ exceptionId: z.uuid('Enter a valid exception ID.') })
const approveExceptionSchema = z
  .object({ expiresAt: z.iso.datetime({ offset: true }).nullable(), reason: reasonSchema })
  .strict()
const revokeExceptionSchema = z.object({ reason: reasonSchema }).strict()
const maximumPostgresBigint = '9223372036854775807'
const auditHistoryQuerySchema = z.object({
  beforeAuditSequence: z
    .string()
    .regex(/^[1-9]\d*$/)
    .refine(
      (value) =>
        value.length < maximumPostgresBigint.length ||
        (value.length === maximumPostgresBigint.length && value <= maximumPostgresBigint),
      { message: 'Audit sequence exceeds the supported range.' },
    )
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const organizationReviewRoutes = new Hono<OrganizationSessionEnv>()
  .get('/roster-coverage', requireOrganizationHr, async (context) =>
    context.json(await listOrganizationRosterCoverage()),
  )
  .get('/exceptions', requireOrganizationHr, async (context) => {
    const [exceptions, reviewCandidates] = await Promise.all([
      listCurrentOrganizationCharacterExceptions(),
      listCurrentOrganizationCharacterExceptionCandidates(),
    ])
    return context.json({ exceptions, reviewCandidates })
  })
  .get(
    '/audit',
    requireOrganizationHr,
    zValidator('query', auditHistoryQuerySchema),
    async (context) => {
      const query = context.req.valid('query')
      return context.json(
        await listCurrentOrganizationAuditHistory({
          beforeAuditSequence: query.beforeAuditSequence
            ? BigInt(query.beforeAuditSequence)
            : undefined,
          limit: query.limit,
        }),
      )
    },
  )
  .post(
    '/members/:userId/characters/:characterId/exception',
    requireTrustedOrigin,
    requireOrganizationHr,
    zValidator('param', characterExceptionParamsSchema),
    zValidator('json', approveExceptionSchema),
    async (context) => {
      try {
        const parameters = context.req.valid('param')
        const body = context.req.valid('json')
        const exception = await approveOrganizationCharacterException({
          actorUserId: context.var.session!.userId,
          characterId: parameters.characterId,
          expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          reason: body.reason,
          userId: parameters.userId,
        })
        return context.json({ exception }, 201)
      } catch (error) {
        return characterExceptionMutationFailure(context, error)
      }
    },
  )
  .post(
    '/exceptions/:exceptionId/expire',
    requireTrustedOrigin,
    requireOrganizationHr,
    zValidator('param', exceptionParamsSchema),
    zValidator('json', revokeExceptionSchema),
    async (context) => {
      try {
        const exception = await expireOrganizationCharacterException({
          actorUserId: context.var.session!.userId,
          exceptionId: context.req.valid('param').exceptionId,
          reason: context.req.valid('json').reason,
        })
        return context.json({ exception })
      } catch (error) {
        return characterExceptionMutationFailure(context, error)
      }
    },
  )
  .post(
    '/exceptions/:exceptionId/revoke',
    requireTrustedOrigin,
    requireOrganizationHr,
    zValidator('param', exceptionParamsSchema),
    zValidator('json', revokeExceptionSchema),
    async (context) => {
      try {
        const exception = await revokeOrganizationCharacterException({
          actorUserId: context.var.session!.userId,
          exceptionId: context.req.valid('param').exceptionId,
          reason: context.req.valid('json').reason,
        })
        return context.json({ exception })
      } catch (error) {
        return characterExceptionMutationFailure(context, error)
      }
    },
  )

function characterExceptionMutationFailure(context: Context, error: unknown) {
  if (!(error instanceof OrganizationCharacterExceptionMutationError)) {
    throw error
  }
  switch (error.code) {
    case 'hr-authority-required':
      return context.json(
        { code: 'ORGANIZATION_HR_REQUIRED', message: 'Organization HR authority is required.' },
        403,
      )
    case 'character-not-found':
      return context.json({ code: 'CHARACTER_NOT_FOUND', message: 'Character not found.' }, 404)
    case 'character-affiliation-stale':
      return context.json(
        {
          code: 'CHARACTER_AFFILIATION_STALE',
          message: 'Fresh character affiliation is required to approve an exception.',
        },
        409,
      )
    case 'managed-corporation-evidence-stale':
      return context.json(
        {
          code: 'MANAGED_CORPORATION_EVIDENCE_STALE',
          message: 'Fresh managed-corporation evidence is required to approve an exception.',
        },
        409,
      )
    case 'character-not-external':
      return context.json(
        { code: 'CHARACTER_NOT_EXTERNAL', message: 'Managed characters do not need an exception.' },
        409,
      )
    case 'exception-already-active':
      return context.json(
        { code: 'CHARACTER_EXCEPTION_EXISTS', message: 'An active exception already exists.' },
        409,
      )
    case 'exception-not-found':
      return context.json(
        { code: 'CHARACTER_EXCEPTION_NOT_FOUND', message: 'Exception not found.' },
        404,
      )
    case 'invalid-expiry':
      return context.json(
        { code: 'INVALID_EXCEPTION_EXPIRY', message: 'Exception expiry must be in the future.' },
        400,
      )
  }
}
