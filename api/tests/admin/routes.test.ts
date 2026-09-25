import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class AlreadyConfigured extends Error {}
  class TransferApprovalError extends Error {
    constructor(
      readonly code: ConstructorParameters<
        typeof import('../../src/auth/character-transfer-approvals.js').CharacterTransferApprovalError
      >[0],
    ) {
      super(code)
    }
  }
  return {
    AlreadyConfigured,
    TransferApprovalError,
    createAdminSession: vi.fn(),
    createCharacterTransferApproval: vi.fn(),
    createDeployment: vi.fn(),
    deleteAdminSession: vi.fn(),
    findAdminCredentials: vi.fn(),
    findAdminSession: vi.fn(),
    inspectCharacterTransferApproval: vi.fn(),
    isDeploymentConfigured: vi.fn(),
    listInstalledModuleSettings: vi.fn(),
    loadInstalledShellNavigationOrder: vi.fn(),
    previewCharacterTransfer: vi.fn(),
    resolveOrganization: vi.fn(),
    revokeCharacterTransferApproval: vi.fn(),
    saveInstalledShellNavigationOrder: vi.fn(),
    setInstalledModuleEnabled: vi.fn(),
    setInstalledModuleSectionEnabled: vi.fn(),
    updateOrganization: vi.fn(),
  }
})

vi.mock(import('../../src/env.js'), () => ({
  env: {
    ADMIN_SETUP_SECRET: 'a-secure-setup-secret-that-is-long-enough',
    EVE_CALLBACK_URL: 'http://localhost:8788/auth/eve/callback',
    WEB_ORIGIN: 'http://localhost:3000',
  } as unknown as typeof import('../../src/env.js').env,
}))

vi.mock(import('../../src/admin/store.js'), () => ({
  DeploymentAlreadyConfiguredError: mocks.AlreadyConfigured,
  createAdminSession: mocks.createAdminSession,
  createDeployment: mocks.createDeployment,
  deleteAdminSession: mocks.deleteAdminSession,
  findAdminCredentials: mocks.findAdminCredentials,
  findAdminSession: mocks.findAdminSession,
  isDeploymentConfigured: mocks.isDeploymentConfigured,
  updateDeploymentOrganization: mocks.updateOrganization,
}))

vi.mock(import('../../src/deployment/organization.js'), () => ({
  resolveDeploymentOrganization: mocks.resolveOrganization,
}))

vi.mock(import('../../src/auth/character-transfer-approvals.js'), () => ({
  CharacterTransferApprovalError: mocks.TransferApprovalError,
  createCharacterTransferApproval: mocks.createCharacterTransferApproval,
  inspectCharacterTransferApproval: mocks.inspectCharacterTransferApproval,
  previewCharacterTransfer: mocks.previewCharacterTransfer,
  revokeCharacterTransferApproval: mocks.revokeCharacterTransferApproval,
}))

vi.mock(import('../../src/platform/module-settings.js'), async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/platform/module-settings.js')>()),
  listInstalledModuleSettings: mocks.listInstalledModuleSettings,
  loadInstalledShellNavigationOrder: mocks.loadInstalledShellNavigationOrder,
  saveInstalledShellNavigationOrder: mocks.saveInstalledShellNavigationOrder,
  setInstalledModuleEnabled: mocks.setInstalledModuleEnabled,
  setInstalledModuleSectionEnabled: mocks.setInstalledModuleSectionEnabled,
}))

import { adminRoutes } from '../../src/admin/routes.js'
import { hashPassword } from '../../src/auth/security.js'

const organization = {
  id: 99_005_348,
  name: 'Test Alliance Please Ignore',
  ticker: 'TEST',
  type: 'alliance' as const,
}
const account = {
  adminId: 'bff18af0-04ff-44f8-bb51-b2133b804e7c',
  email: 'owner@example.com',
  organization,
  role: 'owner' as const,
}
const moduleSetting = {
  defaultEnabled: false,
  enabled: true,
  moduleId: 'alpha',
  sections: [],
  updatedAt: '2026-08-25T12:00:00.000Z',
}
const moduleSectionSetting = {
  activationVersion: 1,
  disclosureRevision: 1,
  disclosureVersion: 1,
  enabled: true,
  id: 'skills',
  kind: 'sensitive-evidence' as const,
  moduleId: 'alpha',
  updatedAt: '2026-09-16T12:00:00.000Z',
}
const previewId = '688e2f93-b245-40af-807a-798550540e47'
const approvalId = '66503848-72b8-4fa3-8af5-de056001a37e'
const transferPreview = {
  character: { characterId: 1_404_328_063, name: 'Moving Pilot' },
  destinationMain: { characterId: 2_112_625_428, name: 'Destination Pilot' },
  eligible: true as const,
  expiresAt: new Date('2026-09-11T12:05:00Z'),
  previewId,
  sourceCharacterCount: 1,
}
const transferApproval = {
  approvalId,
  character: transferPreview.character,
  consumedAt: null,
  createdAt: new Date('2026-09-11T12:00:00Z'),
  destinationMain: transferPreview.destinationMain,
  expiresAt: new Date('2026-09-11T12:15:00Z'),
  reason: 'Repair split account',
  revocationReason: null,
  revokedAt: null,
  sourceCharacterCount: 1,
  status: 'pending' as const,
}
const shellNavigationOrder = {
  character: [
    { ownerId: 'core', navigationId: 'core-character-overview' },
    { ownerId: 'core', navigationId: 'core-character-skills' },
    { ownerId: 'core', navigationId: 'core-character-clones' },
    { ownerId: 'core', navigationId: 'core-character-finance' },
    { ownerId: 'core', navigationId: 'core-character-assets' },
    { ownerId: 'core', navigationId: 'core-character-history' },
    { ownerId: 'core', navigationId: 'core-character-mail' },
  ],
  dashboard: [
    { ownerId: 'core', navigationId: 'core-overview' },
    { ownerId: 'core', navigationId: 'core-characters' },
    { ownerId: 'core', navigationId: 'core-mail' },
    { ownerId: 'core', navigationId: 'core-settings' },
    { ownerId: 'core', navigationId: 'core-admin' },
  ],
}

describe('deployment administration routes', () => {
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
    mocks.setInstalledModuleSectionEnabled.mockResolvedValue(moduleSectionSetting)
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
      revocationReason: 'Approval no longer needed',
      revokedAt: new Date('2026-09-11T12:01:00Z'),
      status: 'revoked',
    })
  })

  test('reports first-run setup availability without exposing the secret', async () => {
    const response = await adminRoutes.request('/setup')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toStrictEqual({ available: true, required: true })
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
    await expect(response.json()).resolves.toMatchObject({ code: 'SETUP_DENIED' })
    expect(mocks.resolveOrganization).not.toHaveBeenCalled()
  })

  test('creates the owner, organization, and admin session atomically', async () => {
    const response = await setupRequest()

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toStrictEqual({ account, authenticated: true })
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
    await expect(response.json()).resolves.toMatchObject({ code: 'SETUP_COMPLETE' })
  })

  test('loads and revokes an owner session by opaque cookie', async () => {
    const session = await adminRoutes.request('/session', {
      headers: { Cookie: 'eve_space_admin_session=session-token' },
    })
    await expect(session.json()).resolves.toStrictEqual({ account, authenticated: true })

    const logout = await adminRoutes.request('/logout', {
      headers: {
        Cookie: 'eve_space_admin_session=session-token',
        Origin: 'http://localhost:3000',
      },
      method: 'POST',
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
        body: method === 'POST' ? '{"invalid":true}' : undefined,
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'eve_space_session=member-or-organization-owner-session',
          ...(method === 'POST' && { Origin: 'http://localhost:3000' }),
        },
        method,
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
        body,
        headers: {
          'Content-Type': 'application/json',
          Cookie: 'eve_space_admin_session=session-token',
          Origin: 'https://attacker.invalid',
        },
        method: 'POST',
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
    await expect(response.json()).resolves.toStrictEqual({
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
      body: JSON.stringify({ previewId }),
      headers: adminMutationHeaders(),
      method: 'POST',
    })

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toStrictEqual({
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
      body: JSON.stringify({ reason: 'Approval no longer needed' }),
      headers: adminMutationHeaders(),
      method: 'POST',
    })

    expect(inspect.status).toBe(200)
    await expect(inspect.json()).resolves.toStrictEqual({
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
        body: JSON.stringify({ reason: '  Approval no longer needed  ' }),
        headers: adminMutationHeaders(),
        method: 'POST',
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
      email: account.email,
      id: account.adminId,
      passwordHash: await hashPassword('correct-owner-password'),
    })

    const response = await adminRoutes.request('/login', {
      body: JSON.stringify({ email: account.email, password: 'correct-owner-password' }),
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      method: 'POST',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toStrictEqual({ account, authenticated: true })
    expect(mocks.createAdminSession).toHaveBeenCalledWith(
      account.adminId,
      expect.any(String),
      expect.any(Date),
    )
  })

  test('returns one generic error for invalid local owner credentials', async () => {
    mocks.findAdminCredentials.mockResolvedValue(null)

    const response = await adminRoutes.request('/login', {
      body: JSON.stringify({ email: account.email, password: 'wrong-password' }),
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      method: 'POST',
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toStrictEqual({
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
    await expect(response.json()).resolves.toStrictEqual({ organization })
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
    await expect(response.json()).resolves.toStrictEqual({ modules: [moduleSetting] })
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
    await expect(response.json()).resolves.toStrictEqual({ module: moduleSetting })
    expect(mocks.setInstalledModuleEnabled).toHaveBeenCalledWith('alpha', true)
  })

  test('sets an installed module section to the requested state', async () => {
    const response = await moduleSectionEnablementRequest('alpha', 'skills', { enabled: true })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toStrictEqual({ section: moduleSectionSetting })
    expect(mocks.setInstalledModuleSectionEnabled).toHaveBeenCalledWith('alpha', 'skills', true)
  })

  test('returns not found for an undeclared module section', async () => {
    mocks.setInstalledModuleSectionEnabled.mockResolvedValue(null)

    const response = await moduleSectionEnablementRequest('alpha', 'removed', { enabled: false })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ code: 'MODULE_SECTION_NOT_FOUND' })
  })

  test('validates section identity and enablement before mutation', async () => {
    const [invalidId, invalidBody] = await Promise.all([
      moduleSectionEnablementRequest('alpha', 'NOT VALID', { enabled: true }),
      moduleSectionEnablementRequest('alpha', 'skills', { enabled: 'true' }),
    ])

    expect(invalidId.status).toBe(400)
    expect(invalidBody.status).toBe(400)
    expect(mocks.setInstalledModuleSectionEnabled).not.toHaveBeenCalled()
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
    await expect(loaded.json()).resolves.toStrictEqual({ shellNavigationOrder })

    const saved = await adminRoutes.request('/shell-navigation-order', {
      body: JSON.stringify({ shellNavigationOrder }),
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
      },
      method: 'PUT',
    })
    expect(saved.status).toBe(200)
    await expect(saved.json()).resolves.toStrictEqual({ shellNavigationOrder })
    expect(mocks.saveInstalledShellNavigationOrder).toHaveBeenCalledWith(shellNavigationOrder)
  })

  test('rejects incomplete shell orders before persistence', async () => {
    const response = await adminRoutes.request('/shell-navigation-order', {
      body: JSON.stringify({
        shellNavigationOrder: {
          ...shellNavigationOrder,
          dashboard: shellNavigationOrder.dashboard.filter(
            ({ navigationId }) => navigationId !== 'core-mail',
          ),
        },
      }),
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'eve_space_admin_session=session-token',
        Origin: 'http://localhost:3000',
      },
      method: 'PUT',
    })

    expect(response.status).toBe(400)
    expect(mocks.saveInstalledShellNavigationOrder).not.toHaveBeenCalled()
  })
})

function setupRequest(overrides: { setupSecret?: string; origin?: string } = {}) {
  return adminRoutes.request('/setup', {
    body: JSON.stringify({
      setupSecret: overrides.setupSecret ?? 'a-secure-setup-secret-that-is-long-enough',
      email: 'Owner@Example.com',
      password: 'a-long-administrator-password',
      organizationType: 'alliance',
      organizationId: organization.id,
    }),
    headers: {
      'Content-Type': 'application/json',
      Origin: overrides.origin ?? 'http://localhost:3000',
    },
    method: 'POST',
  })
}

function organizationRequest() {
  return adminRoutes.request('/organization', {
    body: JSON.stringify({ organizationType: 'alliance', organizationId: organization.id }),
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'eve_space_admin_session=session-token',
      Origin: 'http://localhost:3000',
    },
    method: 'PUT',
  })
}

function moduleEnablementRequest(
  moduleId: string,
  body: unknown,
  origin = 'http://localhost:3000',
) {
  return adminRoutes.request(`/modules/${moduleId}`, {
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'eve_space_admin_session=session-token',
      Origin: origin,
    },
    method: 'PUT',
  })
}

function moduleSectionEnablementRequest(moduleId: string, sectionId: string, body: unknown) {
  return adminRoutes.request(`/modules/${moduleId}/sections/${sectionId}`, {
    body: JSON.stringify(body),
    headers: adminMutationHeaders(),
    method: 'PUT',
  })
}

function transferPreviewRequest(
  origin = 'http://localhost:3000',
  overrides: Record<string, unknown> = {},
) {
  return adminRoutes.request('/character-transfer-approvals/preview', {
    body: JSON.stringify({
      characterId: transferPreview.character.characterId,
      destinationMainCharacterId: transferPreview.destinationMain.characterId,
      reason: '  Repair split account  ',
      ...overrides,
    }),
    headers: { ...adminMutationHeaders(), Origin: origin },
    method: 'POST',
  })
}

function adminMutationHeaders() {
  return {
    'Content-Type': 'application/json',
    Cookie: 'eve_space_admin_session=session-token',
    Origin: 'http://localhost:3000',
  }
}
