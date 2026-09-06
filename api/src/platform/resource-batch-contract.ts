import { z } from 'zod'
import { platformCollectionStateIdentitySchema } from './collection-state.js'

export const platformResourceBatchPayloadSchema = z
  .object({
    moduleId: platformCollectionStateIdentitySchema.shape.moduleId,
    resourceId: platformCollectionStateIdentitySchema.shape.resourceId,
    subjectKind: z.literal('character'),
    subjects: z
      .array(
        z
          .object({
            subjectLifecycleId: platformCollectionStateIdentitySchema.shape.subjectLifecycleId,
            subjectId: platformCollectionStateIdentitySchema.shape.subjectId,
          })
          .strict(),
      )
      .min(1),
  })
  .strict()

export type PlatformResourceBatchPayload = z.infer<typeof platformResourceBatchPayloadSchema>
