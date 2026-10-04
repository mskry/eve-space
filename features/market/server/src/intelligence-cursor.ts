import { z } from 'zod'
import { type IntelligenceGeneration } from './intelligence-report.js'
import { type intelligenceQueryFilters } from './intelligence-query.js'
import { MarketReadError, marketReadInput } from './read-input.js'

const cursorSchema = z.strictObject({
  version: z.literal(1),
  generationId: z.uuid(),
  profileId: z.uuid(),
  profileRevision: z.string(),
  policyRevision: z.string(),
  catalogue: z.string().length(64),
  query: z.string().length(64),
  lastKey: z
    .string()
    .max(322)
    .regex(/^-?\d{1,160}(?:\.\d{1,160})?$/),
  lastTypeId: z.number().int().positive().safe(),
})
export type IntelligenceCursor = z.infer<typeof cursorSchema>
type IntelligenceCursorFilters = ReturnType<typeof intelligenceQueryFilters>
type IntelligenceCursorBinding = Omit<IntelligenceCursor, 'lastKey' | 'lastTypeId'>
type IntelligenceDigestValue =
  | IntelligenceGeneration['catalogueRevision']
  | IntelligenceCursorFilters
  | IntelligenceCursorBinding

const intelligenceDigest = async (value: IntelligenceDigestValue) =>
  Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))),
  ).toString('hex')
const signingKey = (secret: string) =>
  crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )

export const decodeIntelligenceCursor = (cursor: string): IntelligenceCursor => {
  const pieces = cursor.split('.')
  if (pieces.length !== 2 || !/^[\w-]{1,4000}$/.test(pieces[0]!) || !/^[\w-]{43}$/.test(pieces[1]!))
    throw new MarketReadError('MARKET_INTELLIGENCE_RESTART_REQUIRED', 409)
  try {
    return marketReadInput(
      cursorSchema,
      JSON.parse(Buffer.from(pieces[0]!, 'base64url').toString('utf8')),
    )
  } catch {
    throw new MarketReadError('MARKET_INTELLIGENCE_RESTART_REQUIRED', 409)
  }
}

const binding = async (generation: IntelligenceGeneration, filters: IntelligenceCursorFilters) => ({
  version: 1 as const,
  generationId: generation.generationId,
  profileId: generation.profileId,
  profileRevision: generation.profileRevision,
  policyRevision: generation.policyRevision,
  catalogue: await intelligenceDigest(generation.catalogueRevision),
  query: await intelligenceDigest(filters),
})

export const verifyIntelligenceCursor = async (
  encoded: string,
  cursor: IntelligenceCursor,
  generation: IntelligenceGeneration,
  filters: IntelligenceCursorFilters,
  secret: string,
) => {
  const [payload, signature] = encoded.split('.')
  const key = await signingKey(secret)
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    new Uint8Array(Buffer.from(signature!, 'base64url')),
    new TextEncoder().encode(payload!),
  )
  const { lastKey: _lastKey, lastTypeId: _lastTypeId, ...identity } = cursor
  if (
    !valid ||
    (await intelligenceDigest(identity)) !==
      (await intelligenceDigest(await binding(generation, filters)))
  )
    throw new MarketReadError('MARKET_INTELLIGENCE_RESTART_REQUIRED', 409)
}

export const encodeIntelligenceCursor = async (
  generation: IntelligenceGeneration,
  filters: IntelligenceCursorFilters,
  secret: string,
  lastKey: string,
  lastTypeId: number,
) => {
  const payload = Buffer.from(
    JSON.stringify({ ...(await binding(generation, filters)), lastKey, lastTypeId }),
  ).toString('base64url')
  return (
    payload +
    '.' +
    Buffer.from(
      await crypto.subtle.sign('HMAC', await signingKey(secret), new TextEncoder().encode(payload)),
    ).toString('base64url')
  )
}
