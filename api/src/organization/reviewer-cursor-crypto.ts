import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { env } from '../env.js'
import { z } from 'zod'

const nonceLength = 12
const tagLength = 16
const cursorPayloadSchema = z.json()

const cursorKey = (domain: Buffer) => {
  if (!env.TOKEN_ENCRYPTION_KEY) {
    throw new Error('Reviewer directory is unavailable.')
  }
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64'),
      Buffer.alloc(0),
      domain,
      32,
    ),
  )
}

export const encryptReviewerCursor = <
  Payload extends { readonly f: string; readonly o: number; readonly v: number },
>(
  domain: Buffer,
  payload: Payload,
) => {
  const nonce = randomBytes(nonceLength)
  const cipher = createCipheriv('aes-256-gcm', cursorKey(domain), nonce)
  cipher.setAAD(domain)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(cursorPayloadSchema.parse(payload))),
    cipher.final(),
  ])
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64url')
}

export const decryptReviewerCursor = (
  domain: Buffer,
  cursor: string,
): z.output<typeof cursorPayloadSchema> => {
  const key = cursorKey(domain)
  const encoded = Buffer.from(cursor, 'base64url')
  if (encoded.length <= nonceLength + tagLength || encoded.toString('base64url') !== cursor) {
    throw new TypeError('Invalid reviewer cursor')
  }
  const nonce = encoded.subarray(0, nonceLength)
  const tag = encoded.subarray(nonceLength, nonceLength + tagLength)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAAD(domain)
  decipher.setAuthTag(tag)
  return cursorPayloadSchema.parse(
    JSON.parse(
      Buffer.concat([
        decipher.update(encoded.subarray(nonceLength + tagLength)),
        decipher.final(),
      ]).toString('utf8'),
    ),
  )
}
