import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { EsiReadResult } from '../esi-gateway/feature-execution.js'
import type { CharacterAssetPageSnapshot } from './asset-pages.js'

const fingerprint = z.string().regex(/^[\da-f]{64}$/)
const cursorSchema = z
  .strictObject({
    version: z.literal(1),
    owner: z.string().min(1).max(64),
    characterId: z.int().positive(),
    lifecycle: z.uuid(),
    revision: z.int().nonnegative(),
    anchor: fingerprint,
    pages: z.number().int().min(1).max(1000),
    page: z.number().int().min(1).max(1000),
    offset: z.number().int().min(0).max(999),
    selected: fingerprint.nullable(),
    expiresAt: z.iso.datetime(),
  })
  .refine(
    ({ page, pages, offset, selected }) => page <= pages && (offset === 0 || selected !== null),
  )

export type AssetCursor = z.infer<typeof cursorSchema>

export class AssetCursorRestartError extends Error {
  constructor() {
    super('Asset source changed or cursor expired. Restart from the first page.')
  }
}

export const assetFingerprint = (value: EsiReadResult<CharacterAssetPageSnapshot>) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        page: value.data.page,
        pages: value.data.totalPages,
        assets: value.data.assets,
        validatedAt: value.validatedAt,
        cachedUntil: value.cachedUntil,
      }),
    )
    .digest('hex')

export const encodeAssetCursor = (cursor: AssetCursor) =>
  Buffer.from(JSON.stringify(cursorSchema.parse(cursor))).toString('base64url')

export const decodeAssetCursor = (value: string): AssetCursor => {
  if (value.length > 2048 || !/^[\w-]+$/.test(value)) throw new AssetCursorRestartError()
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
  } catch {
    throw new AssetCursorRestartError()
  }
}
