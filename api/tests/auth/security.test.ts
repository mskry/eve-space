import { createCipheriv } from 'node:crypto'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  encryptionKey: '',
}))

vi.mock('../../src/env.js', () => ({
  getSsoConfig: () => ({ encryptionKey: mocks.encryptionKey }),
}))

import {
  createOpaqueToken,
  decryptTokens,
  encryptTokens,
  hashPassword,
  hashToken,
  tokensMatch,
  verifyPassword,
} from '../../src/auth/security.js'

const encryptionKey = Buffer.alloc(32, 7)

beforeEach(() => {
  mocks.encryptionKey = encryptionKey.toString('base64')
})

describe('opaque tokens', () => {
  test('creates a base64url-encoded 32-byte token', () => {
    const token = createOpaqueToken()

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
  })

  test('hashes tokens with SHA-256', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  test.each([
    ['matching values', 'token-value', 'token-value', true],
    ['different same-length values', 'token-value', 'other-value', false],
    ['different-length values', 'token-value', 'short', false],
    ['missing left value', undefined, 'token-value', false],
    ['missing right value', 'token-value', undefined, false],
    ['empty values', '', '', false],
  ] as const)('compares %s safely', (_case, left, right, expected) => {
    expect(tokensMatch(left, right)).toBe(expected)
  })
})

describe('password hashing', () => {
  test('creates a valid scrypt hash and verifies only the original password', async () => {
    const encoded = await hashPassword('correct horse battery staple')
    const [algorithm, salt, hash] = encoded.split('$')

    expect(algorithm).toBe('scrypt')
    expect(Buffer.from(salt!, 'base64url')).toHaveLength(16)
    expect(Buffer.from(hash!, 'base64url')).toHaveLength(64)
    await expect(verifyPassword('correct horse battery staple', encoded)).resolves.toBe(true)
    await expect(verifyPassword('incorrect password', encoded)).resolves.toBe(false)
  })

  test.each([
    '',
    'argon2$salt$hash',
    'scrypt$$hash',
    'scrypt$salt$',
    'scrypt$salt$not-a-64-byte-hash',
    'scrypt$salt$!',
  ])('rejects malformed password hash %j', async (encoded) => {
    await expect(verifyPassword('password', encoded)).resolves.toBe(false)
  })
})

describe('encrypted tokens', () => {
  test('round-trips access and refresh tokens through AES-256-GCM', () => {
    const tokens = {
      accessToken: 'access-token-value',
      refreshToken: 'refresh-token-value',
    }

    const encrypted = encryptTokens(tokens)
    const [initializationVector, authenticationTag, ciphertext] = encrypted.split('.')

    expect(Buffer.from(initializationVector!, 'base64url')).toHaveLength(12)
    expect(Buffer.from(authenticationTag!, 'base64url')).toHaveLength(16)
    expect(Buffer.from(ciphertext!, 'base64url').length).toBeGreaterThan(0)
    expect(decryptTokens(encrypted)).toEqual(tokens)
  })

  test.each([
    ['initialization vector', 0],
    ['authentication tag', 1],
    ['ciphertext', 2],
  ] as const)('rejects a payload after tampering with its %s', (_part, partIndex) => {
    const parts = encryptTokens({ accessToken: 'access', refreshToken: 'refresh' }).split('.')
    const tampered = Buffer.from(parts[partIndex]!, 'base64url')
    tampered[0] = tampered[0]! ^ 1
    parts[partIndex] = tampered.toString('base64url')

    expect(() => decryptTokens(parts.join('.'))).toThrow(/authenticate/)
  })

  test.each(['', 'one', 'one.two', 'one..three', 'one.two.three.four'])(
    'rejects malformed encrypted payload %j',
    (payload) => {
      expect(() => decryptTokens(payload)).toThrow('Invalid encrypted token payload')
    },
  )

  test('rejects authenticated plaintext that is not JSON', () => {
    expect(() => decryptTokens(encryptPlaintext('not-json'))).toThrow(SyntaxError)
  })

  test.each([
    null,
    [],
    {},
    { accessToken: 'access' },
    { accessToken: 1, refreshToken: 'refresh' },
    { accessToken: 'access', refreshToken: 1 },
  ])('rejects invalid decrypted token payload %#', (payload) => {
    expect(() => decryptTokens(encryptPlaintext(JSON.stringify(payload)))).toThrow(
      'Decrypted token payload is invalid',
    )
  })

  test.each([
    ['31-byte key', Buffer.alloc(31).toString('base64')],
    ['33-byte key', Buffer.alloc(33).toString('base64')],
    ['malformed key', 'not-base64'],
  ])('rejects a %s for encryption and decryption', (_case, invalidKey) => {
    mocks.encryptionKey = invalidKey
    const expected = 'TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key'

    expect(() => encryptTokens({ accessToken: 'access', refreshToken: 'refresh' })).toThrow(
      expected,
    )
    expect(() => decryptTokens('AA.AA.AA')).toThrow(expected)
  })
})

function encryptPlaintext(plaintext: string) {
  const initializationVector = Buffer.alloc(12, 3)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, initializationVector)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return [initializationVector, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString('base64url'))
    .join('.')
}
