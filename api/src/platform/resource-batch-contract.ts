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
            subjectId: platformCollectionStateIdentitySchema.shape.subjectId,
            subjectLifecycleId: platformCollectionStateIdentitySchema.shape.subjectLifecycleId,
          })
          .strict(),
      )
      .min(1),
  })
  .strict()

export type PlatformResourceBatchPayload = z.infer<typeof platformResourceBatchPayloadSchema>
