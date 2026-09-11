import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class AlreadyConfigured extends Error {}
  class TransferApprovalError extends Error {}
  return {
    AlreadyConfigured,
    TransferApprovalError,
    createAdminSession: vi.fn(),
    createDeployment: vi.fn(),
    createCharacterTransferApproval: vi.fn(),
    deleteAdminSession: vi.fn(),
    findAdminCredentials: vi.fn(),
    findAdminSession: vi.fn(),
    isDeploymentConfigured: vi.fn(),
    inspectCharacterTransferApproval: vi.fn(),
    listInstalledModuleSettings: vi.fn(),
    loadInstalledShellNavigationOrder: vi.fn(),
    resolveOrganization: vi.fn(),
    previewCharacterTransfer: vi.fn(),
    revokeCharacterTransferApproval: vi.fn(),
    saveInstalledShellNavigationOrder: vi.fn(),
    setInstalledModuleEnabled: vi.fn(),
    updateOrganization: vi.fn(),
  }
})

vi.mock('../../src/env.js', () => ({
  env: {
    ADMIN_SETUP_SECRET: 'a-secure-setup-secret-that-is-long-enough',
    SESSION_COOKIE_SECURE: false,
    WEB_ORIGIN: 'http://localhost:3000',
  },
}))

vi.mock('../../src/admin/store.js', () => ({
  createAdminSession: mocks.createAdminSession,
  createDeployment: mocks.createDeployment,
  deleteAdminSession: mocks.deleteAdminSession,
  DeploymentAlreadyConfiguredError: mocks.AlreadyConfigured,
  findAdminCredentials: mocks.findAdminCredentials,
  findAdminSession: mocks.findAdminSession,
  isDeploymentConfigured: mocks.isDeploymentConfigured,
  updateDeploymentOrganization: mocks.updateOrganization,
}))

vi.mock('../../src/deployment/organization.js', () => ({
  resolveDeploymentOrganization: mocks.resolveOrganization,
}))

vi.mock('../../src/auth/character-transfer-approvals.js', () => ({
  CharacterTransferApprovalError: mocks.TransferApprovalError,
  createCharacterTransferApproval: mocks.createCharacterTransferApproval,
  inspectCharacterTransferApproval: mocks.inspectCharacterTransferApproval,
  previewCharacterTransfer: mocks.previewCharacterTransfer,
  revokeCharacterTransferApproval: mocks.revokeCharacterTransferApproval,
}))

vi.mock('../../src/platform/module-settings.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/platform/module-settings.js')>()),
  listInstalledModuleSettings: mocks.listInstalledModuleSettings,
  loadInstalledShellNavigationOrder: mocks.loadInstalledShellNavigationOrder,
  saveInstalledShellNavigationOrder: mocks.saveInstalledShellNavigationOrder,
  setInstalledModuleEnabled: mocks.setInstalledModuleEnabled,
}))

import { adminRoutes } from '../../src/admin/routes.js'
import { hashPassword } from '../../src/auth/security.js'

const organization = {
  type: 'alliance' as const,
  id: 99_005_348,
  name: 'Test Alliance Please Ignore',
  ticker: 'TEST',
}
const account = {
  adminId: 'bff18af0-04ff-44f8-bb51-b2133b804e7c',
  email: 'owner@example.com',
  role: 'owner' as const,
  organization,
}
const moduleSetting = {
  moduleId: 'alpha',
  enabled: true,
  defaultEnabled: false,
  updatedAt: '2026-08-25T12:00:00.000Z',
}
const previewId = '688e2f93-b245-40af-807a-798550540e47'
const approvalId = '66503848-72b8-4fa3-8af5-de056001a37e'
const transferPreview = {
  eligible: true as const,
  previewId,
  character: { characterId: 1_404_328_063, name: 'Moving Pilot' },
  destinationMain: { characterId: 2_112_625_428, name: 'Destination Pilot' },
  sourceCharacterCount: 1,
  expiresAt: new Date('2026-09-11T12:05:00Z'),
}
const transferApproval = {
  approvalId,
  character: transferPreview.character,
  destinationMain: transferPreview.destinationMain,
  sourceCharacterCount: 1,
  reason: 'Repair split account',
  status: 'pending' as const,
  createdAt: new Date('2026-09-11T12:00:00Z'),
  expiresAt: new Date('2026-09-11T12:15:00Z'),
  consumedAt: null,
  revokedAt: null,
  revocationReason: null,
}
const shellNavigationOrder = {
  dashboard: [
    { ownerId: 'core', navigationId: 'core-overview' },
    { ownerId: 'core', navigationId: 'core-characters' },
    { ownerId: 'core', navigationId: 'core-mail' },
    { ownerId: 'core', navigationId: 'core-settings' },
    { ownerId: 'core', navigationId: 'core-admin' },
  ],
  character: [
    { ownerId: 'core', navigationId: 'core-character-overview' },
    { ownerId: 'core', navigationId: 'core-character-skills' },
    { ownerId: 'core', navigationId: 'core-character-clones' },
    { ownerId: 'core', navigationId: 'core-character-finance' },
    { ownerId: 'core', navigationId: 'core-character-assets' },
    { ownerId: 'core', navigationId: 'core-character-history' },
    { ownerId: 'core', navigationId: 'core-character-mail' },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isDeploymentConfigured.mockResolvedValue(false)
  mocks.resolveOrganization.mockResolvedValue(organization)
  mocks.createDeployment.mockResolvedValue(account)
  mocks.findAdminSession.mockResolvedValue(account)
  mocks.listInstalledModuleSettings.mockResolvedValue([])
  mocks.loadInstalledShellNavigationOrder.mockResolvedValue(shellNavigationOrder)
  mocks.saveInstalledShellNavigationOrder.mockResolvedValue(shellNavigationOrder)
  mocks.setInstalledModuleEnabled.mockResolvedValue(moduleSetting)
  mocks.previewCharacterTransfer.mockResolvedValue(transferPreview)
  mocks.createCharacterTransferApproval.mockResolvedValue({
    approval: transferApproval,
    secret: 'transfer-link-secret-value-that-is-long-enough',
  })
  mocks.inspectCharacterTransferApproval.mockResolvedValue({
    approval: transferApproval,
    audit: [],
  })
  mocks.revokeCharacterTransferApproval.mockResolvedValue({
    ...transferApproval,
    status: 'revoked',
    revokedAt: new Date('2026-09-11T12:01:00Z'),
    revocationReason: 'Approval no longer needed',
  })
})

describe('deployment administration routes', () => {
  test('reports first-run setup availability without exposing the secret', async () => {
    const response = await adminRoutes.request('/setup')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ required: true, available: true })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  test('rejects state changes from an untrusted origin', async () => {
    const response = await setupRequest({ origin: 'https://attacker.invalid' })

    expect(response.status).toBe(403)
    expect(mocks.resolveOrganization).not.toHaveBeenCalled()
  })

  test('rejects an invalid setup secret before resolving EVE data', async () => {
    const response = await setupRequest({ setupSecret: 'wrong-secret' })

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'SETUP_DENIED' })
    expect(mocks.resolveOrganization).not.toHaveBeenCalled()
  })

  test('creates the owner, organization, and admin session atomically', async () => {
    const response = await setupRequest()

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ authenticated: true, account })
    expect(response.headers.get('set-cookie')).toContain('eve_space_admin_session=')
    expect(mocks.resolveOrganization).toHaveBeenCalledWith('alliance', organization.id)
    expect(mocks.createDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'owner@example.com',
        organization,
        passwordHash: expect.stringMatching(/^scrypt\$/),
      }),
    )
  })

  test('returns a conflict when another setup request won the claim', async () => {
    mocks.createDeployment.mockRejectedValue(new mocks.AlreadyConfigured())

    const response = await setupRequest()

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'SETUP_COMPLETE' })
  })

  test('loads and revokes an owner session by opaque cookie', async () => {
    const session = await adminRoutes.request('/session', {
      headers: { Cookie: 'eve_space_admin_session=session-token' },
    })
    expect(await session.json()).toEqual({ authenticated: true, account })

    const logout = await adminRoutes.request('/logout', {
      method: 'POST',
      headers: {
        Cookie: 'eve_space_admin_session=session-token',
        Origin: 'http://localhost:3000',
      },
    })
    expect(logout.status).toBe(204)
    expect(mocks.deleteAdminSession).toHaveBeenCalledWith('session-token')
  })

  test('denies transfer preview before resolving ownership when the admin session is missing', async () => {
    mocks.findAdminSession.mockResolvedValueOnce(null)

    const response = await transferPreviewRequest()

    expect(response.status).toBe(401)
    expect(mocks.previewCharacterTransfer).not.toHaveBeenCalled()
  })

  test.each([
    ['preview', '/character-transfer-approvals/preview', 'POST'],
    ['creation', '/character-transfer-approvals', 'POST'],
    ['inspection', `/character-transfer-approvals/${approvalId}`, 'GET'],
    ['revocation', `/character-transfer-approvals/${approvalId}/revoke`, 'POST'],
  ])(
    'denies transfer %s to an ordinary EVE or organization-owner session before validation',
    async (_name, path, method) => {
      const response = await adminRoutes.request(path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'eve_space_session=member-or-organization-owner-session',
          ...(method === 'POST' ? { Origin: 'http://localhost:3000' } : {}),
        },
        body: method === 'POST' ? '{"invalid":true}' : undefined,
      })

      expect(response.status).toBe(401)
      expect(mocks.previewCharacterTransfer).not.toHaveBeenCalled()
      expect(mocks.createCharacterTransferApproval).not.toHaveBeenCalled()
      expect(mocks.inspectCharacterTransferApproval).not.toHaveBeenCalled()
      expect(mocks.revokeCharacterTransferApproval).not.toHaveBeenCalled()
    },
  )

  test('rejects transfer mutations from an untrusted origin before resolving ownership', async () => {
    const response = await transferPreviewRequest('https://attacker.invalid')

    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.findAdminSession).not.toHaveBeenCalled()
    expect(mocks.previewCharacterTransfer).not.toHaveBeenCalled()
  })

  test.each([
    ['creation', '/character-transfer-approvals', JSON.stringify({ previewId })],
    [
      'revocation',
      `/character-transfer-approvals/${approvalId}/revoke`,
      JSON.stringify({ reason: 'Approval no longer needed' }),
    ],
  ])(
    'rejects transfer %s CSRF before administrator or approval resolution',
    async (_name, path, body) => {
      const response = await adminRoutes.request(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'eve_space_admin_session=session-token',
          Origin: 'https://attacker.invalid',
        },
        body,
      })

      expect(response.status).toBe(403)
      expect(mocks.findAdminSession).not.toHaveBeenCalled()
      expect(mocks.createCharacterTransferApproval).not.toHaveBeenCalled()
      expect(mocks.revokeCharacterTransferApproval).not.toHaveBeenCalled()
    },
  )

  test('previews only the specified transfer through the authenticated administrator', async () => {
    const response = await transferPreviewRequest()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      preview: { ...transferPreview, expiresAt: transferPreview.expiresAt.toISOString() },
    })
    expect(mocks.previewCharacterTransfer).toHaveBeenCalledWith({
      administratorId: account.adminId,
      characterId: transferPreview.character.characterId,
      destinationMainCharacterId: transferPreview.destinationMain.characterId,
      reason: 'Repair split account',
    })
  })

  test('accepts and trims the maximum transfer reason length', async () => {
    const reason = 'r'.repeat(1000)

    const response = await transferPreviewRequest('http://localhost:3000', {
      reason: ` ${reason} `,
    })

    expect(response.status).toBe(200)
    expect(mocks.previewCharacterTransfer).toHaveBeenCalledWith(expect.objectContaining({ reason }))
  })

  test.each([
    ['blank', { reason: '   ' }],
    ['too long', { reason: 'r'.repeat(1001) }],
    ['non-string', { reason: 7 }],
    ['an unexpected field', { reason: 'Repair split account', sourceUserId: 'forged-user' }],
  ])('rejects %s transfer preview input before resolution', async (_name, body) => {
    const response = await transferPreviewRequest('http://localhost:3000', body)

    expect(response.status).toBe(400)
    expect(mocks.previewCharacterTransfer).not.toHaveBeenCalled()
  })

  test('creates a fragment-only destination link without returning the secret separately', async () => {
    const response = await adminRoutes.request('/character-transfer-approvals', {
      method: 'POST',
      headers: adminMutationHeaders(),
      body: JSON.stringify({ previewId }),
    })

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toEqual({
      approval: {
        ...transferApproval,
        createdAt: transferApproval.createdAt.toISOString(),
        expiresAt: transferApproval.expiresAt.toISOString(),
      },
      transferLink: `http://localhost:3000/transfer#approval=${approvalId}&secret=transfer-link-secret-value-that-is-long-enough`,
    })
    expect(JSON.stringify(body)).not.toContain('"secret"')
  })

  test('inspects and revokes a bounded approval through administrator authentication', async () => {
    const inspect = await adminRoutes.request(`/character-transfer-approvals/${approvalId}`, {
      headers: { Cookie: 'eve_space_admin_session=session-token' },
    })
    const revoke = await adminRoutes.request(`/character-transfer-approvals/${approvalId}/revoke`, {
      method: 'POST',
      headers: adminMutationHeaders(),
      body: JSON.stringify({ reason: 'Approval no longer needed' }),
    })

    expect(inspect.status).toBe(200)
    expect(await inspect.json()).toEqual({
      approval: {
        ...transferApproval,
        createdAt: transferApproval.createdAt.toISOString(),
        expiresAt: transferApproval.expiresAt.toISOString(),
      },
      audit: [],
    })
    expect(revoke.status).toBe(200)
    expect(mocks.inspectCharacterTransferApproval).toHaveBeenCalledWith(approvalId)
    expect(mocks.revokeCharacterTransferApproval).toHaveBeenCalledWith({
      administratorId: account.adminId,
      approvalId,
      reason: 'Approval no longer needed',
    })
  })

  test('trims a bounded revocation reason before mutation', async () => {
    const response = await adminRoutes.request(
      `/character-transfer-approvals/${approvalId}/revoke`,
      {
        method: 'POST',
        headers: adminMutationHeaders(),
        body: JSON.stringify({ reason: '  Approval no longer needed  ' }),
      },
    )

    expect(response.status).toBe(200)
    expect(mocks.revokeCharacterTransferApproval).toHaveBeenCalledWith({
      administratorId: account.adminId,
      approvalId,
      reason: 'Approval no longer needed',
    })
  })

  test('creates a session for valid local owner credentials', async () => {
    mocks.findAdminCredentials.mockResolvedValue({
      id: account.adminId,
      email: account.email,
      passwordHash: await hashPassword('correct-owner-password'),
    })

    const response = await adminRoutes.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email: account.email, password: 'correct-owner-password' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ authenticated: true, account })
    expect(mocks.createAdminSession).toHaveBeenCalledWith(
      account.adminId,
      expect.any(String),
      expect.any(Date),
    )
  })

  test('returns one generic error for invalid local owner credentials', async () => {
    mocks.findAdminCredentials.mockResolvedValue(null)

    const response = await adminRoutes.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ email: account.email, password: 'wrong-password' }),
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      code: 'ADMIN_AUTH_FAILED',
      message: 'Email or password is incorrect.',
    })
  })

  test('requires an owner session before changing the organization', async () => {
    mocks.findAdminSession.mockResolvedValue(null)

    const response = await organizationRequest()

    expect(response.status).toBe(401)
    expect(mocks.resolveOrganization).not.toHaveBeenCalled()
  })

  test('verifies and updates the configured organization for the owner', async () => {
    const response = await organizationRequest()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ organization })
    expect(mocks.updateOrganization).toHaveBeenCalledWith(organization, account.adminId)
  })

  test('requires a local owner session before listing installed modules', async () => {
    mocks.findAdminSession.mockResolvedValue(null)

    const response = await adminRoutes.request('/modules', {
      headers: { Cookie: 'eve_space_admin_session=expired-token' },
    })

    expect(response.status).toBe(401)
    expect(mocks.listInstalledModuleSettings).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  test('lists current module settings for the local owner', async () => {
    mocks.listInstalledModuleSettings.mockResolvedValue([moduleSetting])

    const response = await adminRoutes.request('/modules', {
      headers: { Cookie: 'eve_space_admin_session=session-token' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ modules: [moduleSetting] })
  })

  test('validates explicit module enablement before mutation', async () => {
    const response = await moduleEnablementRequest('alpha', { enabled: 'false' })

    expect(response.status).toBe(400)
    expect(mocks.setInstalledModuleEnabled).not.toHaveBeenCalled()
  })

  test('returns not found rather than mutating an uninstalled module row', async () => {
    mocks.setInstalledModuleEnabled.mockResolvedValue(null)

    const response = await moduleEnablementRequest('removed-module', { enabled: true })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ code: 'MODULE_NOT_FOUND' })
    expect(mocks.setInstalledModuleEnabled).toHaveBeenCalledWith('removed-module', true)
  })

  test('sets an installed module to the requested state idempotently', async () => {
    const response = await moduleEnablementRequest('alpha', { enabled: true })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ module: moduleSetting })
    expect(mocks.setInstalledModuleEnabled).toHaveBeenCalledWith('alpha', true)
  })

  test('rejects module state changes from an untrusted origin', async () => {
    const response = await moduleEnablementRequest(
      'alpha',
      { enabled: true },
      'https://attacker.invalid',
    )

    expect(response.status).toBe(403)
    expect(mocks.findAdminSession).not.toHaveBeenCalled()
    expect(mocks.setInstalledModuleEnabled).not.toHaveBeenCalled()
  })

  test('loads and replaces the shared shell order without presentation metadata', async () => {
    const headers = { Cookie: 'eve_space_admin_session=session-token' }
    const loaded = await adminRoutes.request('/shell-navigation-order', { headers })
    expect(await loaded.json()).toEqual({ shellNavigationOrder })

    const saved = await adminRoutes.request('/shell-navigation-order', {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ shellNavigationOrder }),
    })
    expect(saved.status).toBe(200)
    await expect(saved.json()).resolves.toEqual({ shellNavigationOrder })
    expect(mocks.saveInstalledShellNavigationOrder).toHaveBeenCalledWith(shellNavigationOrder)
  })

  test('rejects incomplete shell orders before persistence', async () => {
    const response = await adminRoutes.request('/shell-navigation-order', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'eve_space_admin_session=session-token',
        Origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        shellNavigationOrder: {
          ...shellNavigationOrder,
          dashboard: shellNavigationOrder.dashboard.filter(
            ({ navigationId }) => navigationId !== 'core-mail',
          ),
        },
      }),
    })

    expect(response.status).toBe(400)
    expect(mocks.saveInstalledShellNavigationOrder).not.toHaveBeenCalled()
  })
})

function setupRequest(overrides: { setupSecret?: string; origin?: string } = {}) {
  return adminRoutes.request('/setup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: overrides.origin ?? 'http://localhost:3000',
    },
    body: JSON.stringify({
      setupSecret: overrides.setupSecret ?? 'a-secure-setup-secret-that-is-long-enough',
      email: 'Owner@Example.com',
      password: 'a-long-administrator-password',
      organizationType: 'alliance',
      organizationId: organization.id,
    }),
  })
}

function organizationRequest() {
  return adminRoutes.request('/organization', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'eve_space_admin_session=session-token',
      Origin: 'http://localhost:3000',
    },
    body: JSON.stringify({ organizationType: 'alliance', organizationId: organization.id }),
  })
}

function moduleEnablementRequest(
  moduleId: string,
  body: unknown,
  origin = 'http://localhost:3000',
) {
  return adminRoutes.request(`/modules/${moduleId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'eve_space_admin_session=session-token',
      Origin: origin,
    },
    body: JSON.stringify(body),
  })
}

function transferPreviewRequest(
  origin = 'http://localhost:3000',
  overrides: Record<string, unknown> = {},
) {
  return adminRoutes.request('/character-transfer-approvals/preview', {
    method: 'POST',
    headers: { ...adminMutationHeaders(), Origin: origin },
    body: JSON.stringify({
      characterId: transferPreview.character.characterId,
      destinationMainCharacterId: transferPreview.destinationMain.characterId,
      reason: '  Repair split account  ',
      ...overrides,
    }),
  })
}

function adminMutationHeaders() {
  return {
    'Content-Type': 'application/json',
    Cookie: 'eve_space_admin_session=session-token',
    Origin: 'http://localhost:3000',
  }
}
