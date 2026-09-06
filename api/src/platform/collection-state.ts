import {
  isReservedPlatformModuleId,
  platformContributionIdPattern,
  platformModuleIdMaxLength,
  platformModuleIdPattern,
  platformSubjectKinds,
} from '@eve-space/platform-module-contract'
import { z } from 'zod'

export const platformCollectionFailureClasses = [
  'authorization-required',
  'esi-cooldown',
  'esi-unavailable',
  'response-invalid',
  'mapping-failed',
  'persistence-failed',
  'unknown',
] as const

export type PlatformCollectionFailureClass = (typeof platformCollectionFailureClasses)[number]

const installedModuleIdSchema = z
  .string()
  .max(platformModuleIdMaxLength)
  .regex(platformModuleIdPattern)
  .refine((moduleId) => !isReservedPlatformModuleId(moduleId), {
    message: 'Reserved platform module identity',
  })

const resourceOwnerIdSchema = z.union([z.literal('core'), installedModuleIdSchema])

export const platformCollectionStateIdentitySchema = z
  .object({
    moduleId: resourceOwnerIdSchema,
    resourceId: z.string().regex(platformContributionIdPattern),
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
  })
  .strict()

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
