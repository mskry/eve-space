import {
  isReservedPlatformModuleId,
  platformModuleIdMaxLength,
  platformModuleIdPattern,
} from '@eve-space/platform-module-contract'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import {
  createAdminSession,
  createDeployment,
  deleteAdminSession,
  DeploymentAlreadyConfiguredError,
  findAdminCredentials,
  findAdminSession,
  isDeploymentConfigured,
  updateDeploymentOrganization,
  type AdminSessionAccount,
} from './store.js'
import { resolveDeploymentOrganization } from '../deployment/organization.js'
import { env } from '../env.js'
import { platformNavigationDefaults } from '../generated/platform/installed-module-runtime.js'
import {
  isCompleteShellNavigationOrder,
  listInstalledModuleSettings,
  loadInstalledShellNavigationOrder,
  saveInstalledShellNavigationOrder,
  setInstalledModuleEnabled,
} from '../platform/module-settings.js'
import { createOpaqueToken, hashPassword, tokensMatch, verifyPassword } from '../auth/security.js'
import { zValidator } from '../http/validation.js'

type AdminEnv = { Variables: { adminSession: AdminSessionAccount | null } }

const adminSessionCookie = 'eve_space_admin_session'
const adminSessionDurationSeconds = 12 * 60 * 60
const adminEmailSchema = z
  .string()
  .trim()
  .pipe(z.email('Enter a valid administrator email address.'))
const organizationSchema = z.object({
  organizationType: z.enum(['corporation', 'alliance']),
  organizationId: z.coerce.number().int().positive('Enter a valid EVE organization ID.'),
})
const setupSchema = organizationSchema.extend({
  setupSecret: z.string().min(1, 'Enter the deployment setup secret.'),
  email: adminEmailSchema,
  password: z.string().min(12, 'Administrator password must be at least 12 characters.').max(256),
})
const loginSchema = z.object({
  email: adminEmailSchema,
  password: z.string().min(1, 'Enter the administrator password.').max(256),
})
const moduleIdSchema = z
  .string()
  .regex(platformModuleIdPattern, 'Enter a valid installed module ID.')
  .max(platformModuleIdMaxLength, 'Enter a valid installed module ID.')
  .refine((moduleId) => !isReservedPlatformModuleId(moduleId), {
    message: 'Enter a valid installed module ID.',
  })
const moduleParamsSchema = z.object({ moduleId: moduleIdSchema })
const moduleEnablementSchema = z.object({ enabled: z.boolean() }).strict()
const navigationIdentitySchema = z
  .object({ ownerId: z.string(), navigationId: z.string() })
  .strict()
const shellNavigationOrderSchema = z
  .object({
    dashboard: z.array(navigationIdentitySchema),
    character: z.array(navigationIdentitySchema),
  })
  .strict()
  .refine((order) => isCompleteShellNavigationOrder(order, platformNavigationDefaults), {
    message: 'Navigation order must include every current entry exactly once.',
  })
const shellNavigationOrderRequestSchema = z
  .object({ shellNavigationOrder: shellNavigationOrderSchema })
  .strict()

const requireTrustedOrigin: MiddlewareHandler<AdminEnv> = async (context, next) => {
  if (context.req.method === 'GET' || context.req.method === 'HEAD') return next()
  if (context.req.header('Origin') !== env.WEB_ORIGIN) {
    return context.json({ code: 'INVALID_ORIGIN', message: 'Request origin is not allowed.' }, 403)
  }
  return next()
}

const loadAdminSession: MiddlewareHandler<AdminEnv> = async (context, next) => {
  setPrivateHeaders(context)
  const token = getCookie(context, adminSessionCookie)
  context.set('adminSession', token ? await findAdminSession(token) : null)
  return next()
}

const requireAdminSession: MiddlewareHandler<AdminEnv> = async (context, next) => {
  if (!context.var.adminSession)
    return context.json(
      { code: 'ADMIN_AUTH_REQUIRED', message: 'Administrator login is required.' },
      401,
    )
  return next()
}

export const adminRoutes = new Hono<AdminEnv>()
  .use('*', requireTrustedOrigin)
  .get('/setup', async (context) => {
    setPrivateHeaders(context)
    return context.json({
      required: !(await isDeploymentConfigured()),
      available: Boolean(env.ADMIN_SETUP_SECRET),
    })
  })
  .post('/setup', zValidator('json', setupSchema), async (context) => {
    setPrivateHeaders(context)
    if (!env.ADMIN_SETUP_SECRET) {
      return context.json(
        { code: 'SETUP_UNAVAILABLE', message: 'Deployment setup is not enabled.' },
        503,
      )
    }

    const input = context.req.valid('json')
    if (!tokensMatch(input.setupSecret, env.ADMIN_SETUP_SECRET)) {
      return context.json({ code: 'SETUP_DENIED', message: 'Setup credentials are invalid.' }, 403)
    }

    try {
      const organization = await resolveDeploymentOrganization(
        input.organizationType,
        input.organizationId,
      )
      const sessionToken = createOpaqueToken()
      const account = await createDeployment({
        email: input.email.toLowerCase(),
        passwordHash: await hashPassword(input.password),
        sessionToken,
        sessionExpiresAt: sessionExpiry(),
        organization,
      })
      setAdminSessionCookie(context, sessionToken)
      return context.json({ authenticated: true as const, account }, 201)
    } catch (error) {
      if (error instanceof DeploymentAlreadyConfiguredError) {
        return context.json(
          { code: 'SETUP_COMPLETE', message: 'Deployment setup is already complete.' },
          409,
        )
      }
      return organizationFailure(context, error)
    }
  })
  .post('/login', zValidator('json', loginSchema), async (context) => {
    setPrivateHeaders(context)
    const input = context.req.valid('json')
    const credentials = await findAdminCredentials(input.email.toLowerCase())
    let valid = false
    if (credentials) valid = await verifyPassword(input.password, credentials.passwordHash)
    else await hashPassword(input.password)
    if (!credentials || !valid) {
      return context.json(
        { code: 'ADMIN_AUTH_FAILED', message: 'Email or password is incorrect.' },
        401,
      )
    }

    const sessionToken = createOpaqueToken()
    await createAdminSession(credentials.id, sessionToken, sessionExpiry())
    setAdminSessionCookie(context, sessionToken)
    const account = await findAdminSession(sessionToken)
    if (!account) throw new Error('Failed to create administrator session')
    return context.json({ authenticated: true as const, account })
  })
  .get('/session', loadAdminSession, (context) => {
    setPrivateHeaders(context)
    const account = context.var.adminSession
    return account
      ? context.json({ authenticated: true as const, account })
      : context.json({ authenticated: false as const })
  })
  .post('/logout', loadAdminSession, async (context) => {
    setPrivateHeaders(context)
    const token = getCookie(context, adminSessionCookie)
    if (token) await deleteAdminSession(token)
    deleteCookie(context, adminSessionCookie, {
      path: '/',
      secure: env.SESSION_COOKIE_SECURE,
    })
    return context.body(null, 204)
  })
  .put(
    '/organization',
    loadAdminSession,
    requireAdminSession,
    zValidator('json', organizationSchema),
    async (context) => {
      setPrivateHeaders(context)
      const input = context.req.valid('json')
      try {
        const organization = await resolveDeploymentOrganization(
          input.organizationType,
          input.organizationId,
        )
        await updateDeploymentOrganization(organization)
        return context.json({ organization })
      } catch (error) {
        return organizationFailure(context, error)
      }
    },
  )
  .get('/modules', loadAdminSession, requireAdminSession, async (context) =>
    context.json({ modules: await listInstalledModuleSettings() }, 200),
  )
  .put(
    '/modules/:moduleId',
    loadAdminSession,
    requireAdminSession,
    zValidator('param', moduleParamsSchema),
    zValidator('json', moduleEnablementSchema),
    async (context) => {
      const { moduleId } = context.req.valid('param')
      const { enabled } = context.req.valid('json')
      const module = await setInstalledModuleEnabled(moduleId, enabled)
      if (!module)
        return context.json(
          { code: 'MODULE_NOT_FOUND', message: 'Installed module not found.' },
          404,
        )
      return context.json({ module }, 200)
    },
  )
  .get('/shell-navigation-order', loadAdminSession, requireAdminSession, async (context) =>
    context.json({ shellNavigationOrder: await loadInstalledShellNavigationOrder() }, 200),
  )
  .put(
    '/shell-navigation-order',
    loadAdminSession,
    requireAdminSession,
    zValidator('json', shellNavigationOrderRequestSchema),
    async (context) =>
      context.json(
        {
          shellNavigationOrder: await saveInstalledShellNavigationOrder(
            context.req.valid('json').shellNavigationOrder,
          ),
        },
        200,
      ),
  )

function sessionExpiry() {
  return new Date(Date.now() + adminSessionDurationSeconds * 1_000)
}

function setAdminSessionCookie(context: Parameters<typeof setCookie>[0], token: string) {
  setCookie(context, adminSessionCookie, token, {
    path: '/',
    httpOnly: true,
    secure: env.SESSION_COOKIE_SECURE,
    sameSite: 'Lax',
    priority: 'High',
    maxAge: adminSessionDurationSeconds,
  })
}

function setPrivateHeaders(context: {
  header: (name: string, value: string, options?: never) => void
}) {
  context.header('Cache-Control', 'private, no-store')
  context.header('Vary', 'Cookie')
}

function organizationFailure(context: Parameters<typeof setCookie>[0], error: unknown) {
  const status =
    typeof error === 'object' && error && 'status' in error ? Number(error.status) : undefined
  if (status === 404) {
    return context.json(
      { code: 'ORGANIZATION_NOT_FOUND', message: 'EVE organization was not found.' },
      400,
    )
  }
  return context.json(
    { code: 'ESI_UNAVAILABLE', message: 'Unable to verify the EVE organization.' },
    502,
  )
}
