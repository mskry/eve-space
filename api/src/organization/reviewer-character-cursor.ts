import { createHash } from 'node:crypto'
import type { PlatformReviewerCharacterDirectoryInput } from '@eve-space/platform-module-contract/reviewer-directory'
import { z } from 'zod'
import { decryptReviewerCursor, encryptReviewerCursor } from './reviewer-cursor-crypto.js'

const domain = Buffer.from('eve-space:reviewer-character-directory:v1')
const version = 1
// Covers two JSON-escaped 255-character fields, cursor metadata, and encryption/base64 overhead.
export const characterDirectoryCursorSchema = z
  .string()
  .min(1)
  .max(8192)
  .regex(/^[\w-]+$/)
const positionSchema = z.strictObject({
  value: z.union([z.string().min(1).max(255), z.number(), z.null()]),
  characterName: z.string().min(1).max(255),
  characterId: z.number().int().positive(),
  userId: z.uuid(),
  managedMemberLifecycleId: z.uuid(),
  subjectLifecycleId: z.uuid(),
})
const payloadSchema = z.strictObject({
  f: z.string(),
  o: z.number().int().positive(),
  p: positionSchema,
  v: z.literal(version),
})

interface CharacterDirectoryFingerprintInput {
  readonly query: string | null
  readonly corporationId: number | null
  readonly groupId: string | null
  readonly complianceState: PlatformReviewerCharacterDirectoryInput['complianceState'] | null
  readonly blocked: boolean | null
  readonly auditState: PlatformReviewerCharacterDirectoryInput['auditState'] | null
  readonly sort: NonNullable<PlatformReviewerCharacterDirectoryInput['sort']>
  readonly direction: NonNullable<PlatformReviewerCharacterDirectoryInput['direction']>
  readonly limit: number
}

export class ReviewerCharacterDirectoryInputError extends TypeError {
  constructor() {
    super('Invalid reviewer character directory input.')
    this.name = 'ReviewerCharacterDirectoryInputError'
  }
}

export interface CharacterCursorPosition {
  readonly value: string | number | null
  readonly characterName: string
  readonly characterId: number
  readonly userId: string
  readonly managedMemberLifecycleId: string
  readonly subjectLifecycleId: string
}

export const characterDirectoryFingerprint = (inputs: CharacterDirectoryFingerprintInput) =>
  createHash('sha256').update(JSON.stringify(inputs)).digest('base64url').slice(0, 24)

export const encodeCharacterDirectoryCursor = (
  position: CharacterCursorPosition,
  organizationVersion: number,
  fingerprint: string,
) =>
  encryptReviewerCursor(domain, { f: fingerprint, o: organizationVersion, p: position, v: version })

export const decodeCharacterDirectoryCursor = (
  cursor: string,
  organizationVersion: number,
  fingerprint: string,
): CharacterCursorPosition => {
  try {
    const payload = payloadSchema.parse(decryptReviewerCursor(domain, cursor))
    if (payload.o !== organizationVersion) {
      throw new ReviewerCharacterDirectoryInputError()
    }
    if (payload.f !== fingerprint) {
      throw new ReviewerCharacterDirectoryInputError()
    }
    return payload.p
  } catch {
    throw new ReviewerCharacterDirectoryInputError()
  }
}
