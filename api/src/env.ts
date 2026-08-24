import { z } from 'zod'

const optionalValue = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
)

const redisUrl = z
  .string()
  .url()
  .refine((value) => ['redis:', 'rediss:'].includes(new URL(value).protocol), {
    message: 'Expected a redis:// or rediss:// URL',
  })

const positiveInteger = z.coerce.number().int().positive()
const optionalNonNegativeInteger = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.coerce.number().int().nonnegative().optional(),
)
const cronSchedule = z
  .string()
  .trim()
  .regex(/^(\S+\s+){4,5}\S+$/, 'Expected a five- or six-field cron schedule')

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8788),
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: positiveInteger.default(10),
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
  EVE_SSO_TIMEOUT_MS: positiveInteger.default(15_000),
  TOKEN_REFRESH_LOCK_TIMEOUT_MS: positiveInteger.default(45_000),
  TOKEN_REFRESH_CONCURRENCY: positiveInteger.default(4),
  TOKEN_REFRESH_QUEUE_TIMEOUT_MS: positiveInteger.default(30_000),
  ESI_CACHE_MAX_ENTRIES: positiveInteger.default(100),
  ADMIN_SETUP_SECRET: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(32).optional(),
  ),
  SESSION_COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  QUEUE_REDIS_URL: redisUrl.default('redis://localhost:6379'),
  QUEUE_COMPLETED_RETENTION_AGE_SECONDS: positiveInteger.default(86_400),
  QUEUE_COMPLETED_RETENTION_COUNT: positiveInteger.default(1_000),
  QUEUE_FAILED_RETENTION_AGE_SECONDS: positiveInteger.default(604_800),
  QUEUE_FAILED_RETENTION_COUNT: positiveInteger.default(5_000),
  QUEUE_OPERATION_CONCURRENCY: positiveInteger.default(10),
  QUEUE_HIGH_WATER_MARK: positiveInteger.default(1_000),
  QUEUE_PLANNER_SCHEDULE: cronSchedule.default('*/15 * * * *'),
  QUEUE_PLANNER_SCHEDULE_OFFSET_MS: optionalNonNegativeInteger,
  QUEUE_PLANNER_INITIAL_DELAY_MAX_MS: positiveInteger.default(60_000),
  QUEUE_LAG_DEGRADED_SECONDS: positiveInteger.default(300),
  OUTBOX_RELAY_INTERVAL_MS: positiveInteger.default(5_000),
  OUTBOX_RELAY_BATCH_SIZE: positiveInteger.default(100),
  OUTBOX_RELAY_CLAIM_TTL_MS: positiveInteger.default(30_000),
  OUTBOX_RELAY_RETRY_DELAY_MS: positiveInteger.default(10_000),
  OUTBOX_LAG_DEGRADED_SECONDS: positiveInteger.default(300),
  DOMAIN_EVENT_PUBLISHED_RETENTION_DAYS: positiveInteger.default(30),
  WORKER_HEARTBEAT_INTERVAL_MS: positiveInteger.default(15_000),
  WORKER_SHUTDOWN_TIMEOUT_MS: positiveInteger.default(30_000),
  // Must be stable across a container's processes: the healthcheck runs beside the worker.
  WORKER_ID: optionalValue,
})

/**
 * Cross-field invariants. Each of these is satisfiable with the defaults, but tuning one side for a
 * larger deployment without the other produces a failure that only appears under concurrency, so it
 * is rejected at startup instead.
 */
const schemaWithInvariants = schema.superRefine((values, context) => {
  // A refresh holds the per-character advisory lock across the SSO discovery and token calls. If
  // the lock timeout is not longer than that, a second replica aborts with 55P03 instead of waiting
  // for the winner and reading its rotated token, which is the whole point of the lock.
  const worstCaseRefreshMs = values.EVE_SSO_TIMEOUT_MS * 2
  if (values.TOKEN_REFRESH_LOCK_TIMEOUT_MS <= worstCaseRefreshMs) {
    context.addIssue({
      code: 'custom',
      path: ['TOKEN_REFRESH_LOCK_TIMEOUT_MS'],
      message: `Expected more than ${worstCaseRefreshMs}ms (2 x EVE_SSO_TIMEOUT_MS) so a queued replica waits for the winner instead of aborting`,
    })
  }

  // Each in-flight refresh occupies one pooled connection for the duration of the SSO calls. Left
  // unbounded relative to the pool, a batch of simultaneous expiries starves every other query.
  if (values.TOKEN_REFRESH_CONCURRENCY >= values.DATABASE_POOL_MAX) {
    context.addIssue({
      code: 'custom',
      path: ['TOKEN_REFRESH_CONCURRENCY'],
      message: `Expected fewer than DATABASE_POOL_MAX (${values.DATABASE_POOL_MAX}) so refreshes cannot consume every pooled connection`,
    })
  }

  if (values.OUTBOX_RELAY_BATCH_SIZE > values.QUEUE_HIGH_WATER_MARK) {
    context.addIssue({
      code: 'custom',
      path: ['OUTBOX_RELAY_BATCH_SIZE'],
      message: `Expected no more than QUEUE_HIGH_WATER_MARK (${values.QUEUE_HIGH_WATER_MARK})`,
    })
  }

  if (values.OUTBOX_RELAY_CLAIM_TTL_MS <= values.OUTBOX_RELAY_INTERVAL_MS) {
    context.addIssue({
      code: 'custom',
      path: ['OUTBOX_RELAY_CLAIM_TTL_MS'],
      message: `Expected more than OUTBOX_RELAY_INTERVAL_MS (${values.OUTBOX_RELAY_INTERVAL_MS})`,
    })
  }

  if (values.OUTBOX_RELAY_RETRY_DELAY_MS < values.OUTBOX_RELAY_INTERVAL_MS) {
    context.addIssue({
      code: 'custom',
      path: ['OUTBOX_RELAY_RETRY_DELAY_MS'],
      message: `Expected at least OUTBOX_RELAY_INTERVAL_MS (${values.OUTBOX_RELAY_INTERVAL_MS})`,
    })
  }

  if (values.OUTBOX_LAG_DEGRADED_SECONDS * 1_000 <= values.OUTBOX_RELAY_CLAIM_TTL_MS) {
    context.addIssue({
      code: 'custom',
      path: ['OUTBOX_LAG_DEGRADED_SECONDS'],
      message: `Expected a duration longer than OUTBOX_RELAY_CLAIM_TTL_MS (${values.OUTBOX_RELAY_CLAIM_TTL_MS}ms)`,
    })
  }
})

export function parseEnvironment(values: NodeJS.ProcessEnv) {
  return schemaWithInvariants.parse(values)
}

export const env = parseEnvironment(process.env)

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
