import {
  isPlatformContributionId,
  isReservedPlatformModuleId,
  platformModuleIdIssues,
} from '@eve-space/platform-module-contract/identifiers'
import { platformSubjectKinds } from '@eve-space/platform-module-contract/resources'
import { platformCollectionFailureClasses } from '@eve-space/platform-module-contract/server'
import { z } from 'zod'

export { platformCollectionFailureClasses }
export type { PlatformCollectionFailureClass } from '@eve-space/platform-module-contract/server'

const installedModuleIdSchema = z
  .string()
  .refine((value) => !platformModuleIdIssues(value).includes('syntax'), {
    message: 'Platform module identity must use lowercase kebab-case',
  })
  .refine((value) => !platformModuleIdIssues(value).includes('too-long'), {
    message: 'Platform module identity is too long',
  })
  .refine((value) => !isReservedPlatformModuleId(value), {
    message: 'Reserved platform module identity',
  })

const resourceOwnerIdSchema = z.union([z.literal('core'), installedModuleIdSchema])

export const platformCollectionStateIdentitySchema = z
  .object({
    moduleId: resourceOwnerIdSchema,
    resourceId: z.string().refine(isPlatformContributionId),
    subjectKind: z.enum(platformSubjectKinds),
    subjectLifecycleId: z.uuid(),
    subjectId: z.string().trim().min(1),
  })
  .strict()

export const platformCollectionStateWriteSchema = platformCollectionStateIdentitySchema
  .extend({
    nextEligibleAt: z.date().nullable(),
    authorizationGeneration: z.number().int().nonnegative().max(2_147_483_647).nullable(),
    validatedAt: z.date().nullable(),
    lastFailureClass: z.enum(platformCollectionFailureClasses).nullable(),
    organizationDeploymentId: z.literal(1).optional(),
    organizationVersion: z.number().int().positive().optional(),
    targetUserId: z.uuid().optional(),
    managedMemberLifecycleId: z.uuid().optional(),
    sectionId: z.string().refine(isPlatformContributionId).optional(),
    disclosureVersion: z.number().int().positive().optional(),
    sectionActivationVersion: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const authority = [
      value.organizationDeploymentId,
      value.organizationVersion,
      value.targetUserId,
      value.managedMemberLifecycleId,
      value.sectionId,
      value.disclosureVersion,
      value.sectionActivationVersion,
    ]
    const defined = authority.filter((entry) => entry !== undefined).length
    if (defined !== 0 && defined !== authority.length)
      context.addIssue({ code: 'custom', message: 'Managed collection authority is incomplete' })
    if (defined === authority.length && value.authorizationGeneration === null)
      context.addIssue({
        code: 'custom',
        message: 'Managed collection authority requires an authorization generation',
      })
  })

export type PlatformCollectionStateIdentity = z.infer<typeof platformCollectionStateIdentitySchema>
export type PlatformCollectionStateWrite = z.infer<typeof platformCollectionStateWriteSchema>

/**
 * Canonical byte encoding of a collection-state identity.
 *
 * The advisory-lock key and the queue job ID are both derived from this, so they must agree on what
 * "the same resource" means; deriving them from one encoding keeps a new identity field from
 * silently changing only one of them.
 */
export function collectionStateIdentityJson(identity: {
  readonly moduleId: string
  readonly resourceId: string
  readonly subjectKind: string
  readonly subjectLifecycleId: string
  readonly subjectId: string
}) {
  return JSON.stringify([
    identity.moduleId,
    identity.resourceId,
    identity.subjectKind,
    identity.subjectLifecycleId,
    identity.subjectId,
  ])
}
