import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'
import { getSsoConfig } from '../env.js'

const scryptAsync = promisify(scrypt)
const passwordKeyLength = 64

export function createOpaqueToken() {
  return randomBytes(32).toString('base64url')
}

export function hashToken(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export function tokensMatch(left: string | undefined, right: string | undefined) {
  if (!left || !right) return false
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16)
  const derived = (await scryptAsync(password, salt, passwordKeyLength)) as Buffer
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, saltValue, hashValue] = encoded.split('$')
  if (algorithm !== 'scrypt' || !saltValue || !hashValue) return false

  const expected = Buffer.from(hashValue, 'base64url')
  if (expected.length !== passwordKeyLength) return false
  const derived = (await scryptAsync(
    password,
    Buffer.from(saltValue, 'base64url'),
    passwordKeyLength,
  )) as Buffer
  return timingSafeEqual(derived, expected)
}

export function encryptTokens(tokens: { accessToken: string; refreshToken: string }) {
  const key = getEncryptionKey()

  const initializationVector = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, initializationVector)
  const plaintext = Buffer.from(JSON.stringify(tokens), 'utf8')
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authenticationTag = cipher.getAuthTag()

  return [initializationVector, authenticationTag, encrypted]
    .map((value) => value.toString('base64url'))
    .join('.')
}

export function decryptTokens(value: string) {
  const parts = value.split('.')
  if (parts.length !== 3 || parts.some((part) => !part))
    throw new Error('Invalid encrypted token payload')

  const [initializationVector, authenticationTag, encrypted] = parts.map((part) =>
    Buffer.from(part!, 'base64url'),
  )
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), initializationVector!)
  decipher.setAuthTag(authenticationTag!)
  const plaintext = Buffer.concat([decipher.update(encrypted!), decipher.final()]).toString('utf8')
  const parsed = JSON.parse(plaintext) as unknown

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('accessToken' in parsed) ||
    !('refreshToken' in parsed) ||
    typeof parsed.accessToken !== 'string' ||
    typeof parsed.refreshToken !== 'string'
  ) {
    throw new Error('Decrypted token payload is invalid')
  }

  return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken }
}

function getEncryptionKey() {
  const key = Buffer.from(getSsoConfig().encryptionKey, 'base64')

  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key')
  }

  return key
}
