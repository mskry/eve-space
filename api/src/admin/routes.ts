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
import {
  CharacterTransferApprovalError,
  createCharacterTransferApproval,
  inspectCharacterTransferApproval,
  previewCharacterTransfer,
  revokeCharacterTransferApproval,
} from '../auth/character-transfer-approvals.js'
import { resolveDeploymentOrganization } from '../deployment/organization.js'
import { env } from '../env.js'
import { platformNavigationDefaults } from '../generated/platform/installed-module-runtime.js'
import { isCompleteShellNavigationOrder } from '../platform/module-navigation.js'
import {
  listInstalledModuleSettings,
  loadInstalledShellNavigationOrder,
  saveInstalledShellNavigationOrder,
  setInstalledModuleEnabled,
} from '../platform/module-settings.js'
import { createOpaqueToken, hashPassword, tokensMatch, verifyPassword } from '../auth/security.js'
import { privateNoStore, setPrivateHeaders } from '../http/private-response.js'
import { requireTrustedMutationOrigin } from '../http/trusted-origin.js'
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
const transferReasonSchema = z.string().trim().min(1, 'A reason is required.').max(1000)
const transferPreviewSchema = z
  .object({
    characterId: z.number().int().positive(),
    destinationMainCharacterId: z.number().int().positive(),
    reason: transferReasonSchema,
  })
  .strict()
const transferApprovalCreateSchema = z.object({ previewId: z.uuid() }).strict()
const transferApprovalParamsSchema = z.object({ approvalId: z.uuid() })
const transferApprovalRevokeSchema = z.object({ reason: transferReasonSchema }).strict()

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
  .use('*', privateNoStore)
  .use('*', requireTrustedMutationOrigin)
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
        await updateDeploymentOrganization(organization, context.var.adminSession!.adminId)
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
  .post(
    '/character-transfer-approvals/preview',
    loadAdminSession,
    requireAdminSession,
    zValidator('json', transferPreviewSchema),
    async (context) => {
      const preview = await previewCharacterTransfer({
        administratorId: context.var.adminSession!.adminId,
        ...context.req.valid('json'),
      })
      return context.json({ preview }, 200)
    },
  )
  .post(
    '/character-transfer-approvals',
    loadAdminSession,
    requireAdminSession,
    zValidator('json', transferApprovalCreateSchema),
    async (context) => {
      try {
        const { approval, secret } = await createCharacterTransferApproval({
          administratorId: context.var.adminSession!.adminId,
          previewId: context.req.valid('json').previewId,
        })
        const transferLink = new URL('/transfer', env.WEB_ORIGIN)
        transferLink.hash = new URLSearchParams({
          approval: approval.approvalId,
          secret,
        }).toString()
        return context.json({ approval, transferLink: transferLink.toString() }, 201)
      } catch (error) {
        return transferApprovalFailure(context, error)
      }
    },
  )
  .get(
    '/character-transfer-approvals/:approvalId',
    loadAdminSession,
    requireAdminSession,
    zValidator('param', transferApprovalParamsSchema),
    async (context) => {
      const result = await inspectCharacterTransferApproval(context.req.valid('param').approvalId)
      return result
        ? context.json(result, 200)
        : context.json(
            { code: 'TRANSFER_APPROVAL_NOT_FOUND', message: 'Transfer approval not found.' },
            404,
          )
    },
  )
  .post(
    '/character-transfer-approvals/:approvalId/revoke',
    loadAdminSession,
    requireAdminSession,
    zValidator('param', transferApprovalParamsSchema),
    zValidator('json', transferApprovalRevokeSchema),
    async (context) => {
      try {
        const approval = await revokeCharacterTransferApproval({
          administratorId: context.var.adminSession!.adminId,
          approvalId: context.req.valid('param').approvalId,
          reason: context.req.valid('json').reason,
        })
        return context.json({ approval }, 200)
      } catch (error) {
        return transferApprovalFailure(context, error)
      }
    },
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

function transferApprovalFailure(context: Parameters<typeof setCookie>[0], error: unknown) {
  if (!(error instanceof CharacterTransferApprovalError)) throw error
  const unavailable = error.code === 'preview-unavailable' || error.code === 'approval-unavailable'
  return context.json(
    {
      code: unavailable ? 'TRANSFER_APPROVAL_NOT_FOUND' : 'TRANSFER_APPROVAL_UNUSABLE',
      message: unavailable
        ? 'Transfer approval not found.'
        : 'Transfer approval is no longer usable.',
    },
    unavailable ? 404 : 409,
  )
}
