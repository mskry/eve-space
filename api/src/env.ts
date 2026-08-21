import { z } from 'zod'

const optionalValue = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
)

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8788),
  DATABASE_URL: z.string().url().default('postgres://eve_space:eve_space@localhost:5432/eve_space'),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  EVE_CLIENT_ID: optionalValue,
  EVE_CLIENT_SECRET: optionalValue,
  EVE_CALLBACK_URL: z.string().url().default('http://localhost:8788/auth/eve/callback'),
  EVE_SCOPES: z.string().default(''),
  ESI_USER_AGENT: z
    .string()
    .min(1)
    .default('EveSpace/0.1 (eve:Bandera Primary) @evespace/esi-client/2.0.0'),
  TOKEN_ENCRYPTION_KEY: optionalValue,
  ADMIN_SETUP_SECRET: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(32).optional(),
  ),
  SESSION_COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
})

export const env = schema.parse(process.env)

export function getSsoConfig() {
  if (!env.EVE_CLIENT_ID || !env.EVE_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) {
    throw new Error('EVE SSO is not configured')
  }

  return {
    clientId: env.EVE_CLIENT_ID,
    clientSecret: env.EVE_CLIENT_SECRET,
    callbackUrl: env.EVE_CALLBACK_URL,
    encryptionKey: env.TOKEN_ENCRYPTION_KEY,
    scopes: env.EVE_SCOPES.split(/\s+/).filter(Boolean),
  }
}

export function isSsoConfigured() {
  return Boolean(env.EVE_CLIENT_ID && env.EVE_CLIENT_SECRET && env.TOKEN_ENCRYPTION_KEY)
}
