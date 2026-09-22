import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { http, HttpResponse } from 'msw'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import SettingsOrganizationAccess from '../../app/components/settings/SettingsOrganizationAccess.vue'
import { useAuthSession } from '../../app/composables/useAuthSession'
import type { OrganizationContext } from '../../app/queries/organization'
import { createApiClient } from '../../app/utils/api-client'
import { cacheAdmissionForOrganization } from '../support/cache-admission'
import { clearQueryCache } from '../support/clear-query-cache'
import { readWorkspaceFile } from '../support/read-workspace-file'
import { queryServer } from '../support/query-server'

const mountedWrappers: { unmount: () => void }[] = []
const bundleRequests: unknown[] = []
let previewPermissionKey = 'alpha.read'
let bundleResponse = permissionBundles()
let saveFails = false
let permissionReadCount = 0

beforeAll(() => queryServer.listen({ onUnhandledRequest: 'error' }))
afterAll(() => queryServer.close())

beforeEach(() => {
  clearQueryCache()
  bundleRequests.length = 0
  previewPermissionKey = 'alpha.read'
  bundleResponse = permissionBundles()
  saveFails = false
  permissionReadCount = 0
  installHandlers()
})

afterEach(async () => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  clearQueryCache()
  queryServer.resetHandlers()
  document.body.replaceChildren()
  await flushPromises()
})

describe('SettingsOrganizationAccess', () => {
  it('groups exact permission metadata and previews a non-authoritative profile', async () => {
    const wrapper = await mountAccess()

    expect(wrapper.get('h2').text()).toBe('Organization access')
    expect(wrapper.findAll('.organization-access__module')).toHaveLength(2)
    expect(wrapper.text()).toContain('@example/alpha-manifest')
    expect(wrapper.text()).toContain('alpha.read')
    expect(wrapper.text()).toContain('Read alpha evidence.')
    expect(wrapper.text()).toContain('Eligible audiences')
    expect(wrapper.text()).toContain('sensitive')
    expect(wrapper.text()).toContain('Unavailable during compliance review')
    expect(wrapper.findAll('fieldset').length).toBeGreaterThan(0)
    expect(wrapper.get('[aria-live="polite"]').exists()).toBe(true)

    const trigger = button(wrapper, 'PREVIEW Alpha reviewer')
    trigger.element.focus()
    await trigger.trigger('click')
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Alpha profile.'),
    )
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog?.textContent).toContain('Recommended audiences')
    expect(dialog?.textContent).toContain('alpha.read')
    expect(dialog?.textContent).toContain(
      'This suggestion grants no role, group, assignment, or access automatically.',
    )

    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    await flushPromises()
    expect(document.activeElement).toBe(trigger.element)
  })

  it('copies an exact profile snapshot while preserving unrelated draft entries', async () => {
    const wrapper = await mountAccess()
    await button(wrapper, 'EDIT BUNDLE').trigger('click')
    await button(wrapper, 'PREVIEW Alpha reviewer').trigger('click')
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain('alpha.read'),
    )
    clickDialogButton('COPY TO BUNDLE DRAFT')
    await flushPromises()

    expect(bundleRequests).toHaveLength(0)
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('copied to the local bundle draft')
    expect(wrapper.text()).toContain('discord.operations')
    expect(wrapper.text()).toContain('removed.permission')
    expect(checkboxForKey(wrapper, 'alpha.read').element).toHaveProperty('checked', true)
    expect(checkboxForKey(wrapper, 'alpha.old').element).toHaveProperty('checked', false)
    expect(checkboxForKey(wrapper, 'beta.keep').element).toHaveProperty('checked', true)

    previewPermissionKey = 'alpha.changed'
    await button(wrapper, 'PREVIEW Alpha reviewer').trigger('click')
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain('alpha.changed'),
    )
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    await flushPromises()

    expect(checkboxForKey(wrapper, 'alpha.read').element).toHaveProperty('checked', true)
    expect(wrapper.text()).toContain('removed.permission')

    await wrapper.get('.organization-access__unavailable button').trigger('click')
    await button(wrapper, 'CONFIRM REMOVAL').trigger('click')
    await wrapper.get('.organization-access__draft textarea').setValue('  Adopt reviewed profile  ')
    await wrapper.get('.organization-access__draft').trigger('submit')
    await vi.waitFor(() => expect(bundleRequests).toHaveLength(1))

    expect(bundleRequests).toEqual([
      {
        name: 'Operations',
        reason: 'Adopt reviewed profile',
        permissions: [
          { type: 'service', key: 'discord.operations', reviewAllowed: true },
          {
            type: 'module',
            publisherPackage: '@example/beta-manifest',
            moduleId: 'beta',
            key: 'beta.keep',
          },
          {
            type: 'module',
            publisherPackage: '@example/alpha-manifest',
            moduleId: 'alpha',
            key: 'alpha.read',
          },
        ],
        retainedUnavailableEntryIds: [],
      },
    ])
    expect(JSON.stringify(bundleRequests[0])).not.toContain('profileId')
    expect(JSON.stringify(bundleRequests[0])).not.toContain('"reviewAllowed":false')
  })

  it('requires a selected permission to create and announces a successful save', async () => {
    const wrapper = await mountAccess()
    await button(wrapper, 'NEW BUNDLE').trigger('click')
    await wrapper.get('.organization-access__draft input').setValue('New reviewer access')
    await wrapper.get('.organization-access__draft textarea').setValue('Create reviewed access')
    await wrapper.get('.organization-access__draft').trigger('submit')

    expect(bundleRequests).toHaveLength(0)
    expect(wrapper.get('[role="alert"]').text()).toContain('Select at least one permission')

    await checkboxForKey(wrapper, 'alpha.read').setValue(true)
    await wrapper.get('.organization-access__draft').trigger('submit')
    await vi.waitFor(() => expect(bundleRequests).toHaveLength(1))

    expect(bundleRequests[0]).toEqual({
      name: 'New reviewer access',
      reason: 'Create reviewed access',
      permissions: [
        {
          type: 'module',
          publisherPackage: '@example/alpha-manifest',
          moduleId: 'alpha',
          key: 'alpha.read',
        },
      ],
    })
    expect(wrapper.get('[aria-live="polite"]').text()).toBe('Permission bundle created.')
  })

  it('labels unavailable original ownership and confirms removal', async () => {
    bundleResponse = unavailableBundles()
    const wrapper = await mountAccess()

    expect(wrapper.text()).toContain('Unavailable - grants no access')
    expect(wrapper.text()).toContain('@retired/publisher / retired-module')
    expect(wrapper.text()).toContain('Unknown legacy owner')

    await button(wrapper, 'EDIT BUNDLE').trigger('click')
    const removeButton = wrapper
      .findAll('.organization-access__unavailable button')
      .find((candidate) => candidate.text().includes('REMOVE FROM DRAFT'))
    if (!removeButton) throw new Error('Unavailable permission removal button was not found.')
    await removeButton.trigger('click')
    expect(wrapper.text()).toContain('Remove this retained permission from the local draft?')
    await button(wrapper, 'CONFIRM REMOVAL').trigger('click')
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('removed from the local draft')
  })

  it('retains unavailable exact-owner and unknown legacy rows outside current selections', async () => {
    bundleResponse = unavailableBundles()
    const wrapper = await mountAccess()
    await button(wrapper, 'EDIT BUNDLE').trigger('click')
    await wrapper.get('.organization-access__draft textarea').setValue('Keep retained history')
    await wrapper.get('.organization-access__draft').trigger('submit')
    await vi.waitFor(() => expect(bundleRequests).toHaveLength(1))

    expect(bundleRequests[0]).toEqual({
      name: 'Retained permissions',
      reason: 'Keep retained history',
      permissions: [],
      retainedUnavailableEntryIds: [
        '00000000-0000-4000-8000-000000000005',
        '00000000-0000-4000-8000-000000000006',
      ],
    })
  })

  it('requires explicit confirmation before saving an empty cleanup', async () => {
    bundleResponse = cleanupBundles()
    const cleanupWrapper = await mountAccess()
    await button(cleanupWrapper, 'EDIT BUNDLE').trigger('click')
    await checkboxForKey(cleanupWrapper, 'alpha.read').setValue(false)
    await cleanupWrapper.get('.organization-access__draft textarea').setValue('Remove stale access')
    await cleanupWrapper.get('.organization-access__draft').trigger('submit')

    expect(bundleRequests).toHaveLength(0)
    expect(cleanupWrapper.text()).toContain('Save this bundle with no permissions?')
    await button(cleanupWrapper, 'CONFIRM EMPTY BUNDLE').trigger('click')
    await vi.waitFor(() => expect(bundleRequests).toHaveLength(1))
    expect(bundleRequests[0]).toMatchObject({
      reason: 'Remove stale access',
      permissions: [],
      retainedUnavailableEntryIds: [],
    })
    expect(cleanupWrapper.get('[aria-live="polite"]').text()).toBe(
      'Permission bundle cleanup saved.',
    )
  })

  it('preserves a failed draft and announces the failure as an alert', async () => {
    saveFails = true
    const wrapper = await mountAccess()
    await button(wrapper, 'EDIT BUNDLE').trigger('click')
    await wrapper.get('.organization-access__draft textarea').setValue('Keep this draft')
    await wrapper.get('.organization-access__draft').trigger('submit')
    await vi.waitFor(() =>
      expect(wrapper.get('[role="alert"]').text()).toContain('Bundle rejected.'),
    )

    expect(wrapper.find('.organization-access__draft').exists()).toBe(true)
    expect(wrapper.get('.organization-access__draft textarea').element).toHaveProperty(
      'value',
      'Keep this draft',
    )
  })

  it('clears stale DTOs, drafts, dialogs, and obsolete completions on invalidation', async () => {
    let releasePreview!: () => void
    const previewBarrier = new Promise<void>((resolve) => {
      releasePreview = resolve
    })
    queryServer.use(
      http.post('http://localhost:8788/api/organization/permission-profile-preview', async () => {
        await previewBarrier
        return HttpResponse.json(profilePreview('alpha.read'))
      }),
    )
    const wrapper = await mountAccess()
    await button(wrapper, 'EDIT BUNDLE').trigger('click')
    await button(wrapper, 'PREVIEW Alpha reviewer').trigger('click')
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())

    await wrapper.setProps({ invalidationRevision: 1 })
    await flushPromises()
    expect(wrapper.find('.organization-access__draft').exists()).toBe(false)
    expect(wrapper.find('.organization-access__catalog').exists()).toBe(false)
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    releasePreview()
    await flushPromises()
    expect(wrapper.find('.organization-access__draft').exists()).toBe(false)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it.each([
    ['anonymous', { authenticated: false, context: ownerContext() }],
    [
      'non-owner',
      { authenticated: true, context: { ...ownerContext(), isOrganizationOwner: false } },
    ],
    ['blocked', { authenticated: true, context: { ...ownerContext(), isBlocked: true } }],
    ['noncompliant', { authenticated: true, context: { ...ownerContext(), memberAccess: false } }],
  ])('does not request protected data for %s access', async (_name, access) => {
    const wrapper = await mountAccess(access)
    await flushPromises()

    expect(permissionReadCount).toBe(0)
    expect(wrapper.find('.organization-access__catalog').exists()).toBe(false)
  })

  it('uses wrapping responsive contracts without fixed content widths', () => {
    const css = readWorkspaceFile('app/assets/css/pages/settings.css')
    const responsiveCss = readWorkspaceFile('app/assets/css/responsive/settings.css')
    const accessRules = css.slice(
      css.indexOf('.organization-access'),
      css.indexOf('.organization-hr-review'),
    )

    expect(accessRules).toContain('min-width: 0')
    expect(accessRules).toContain('overflow-wrap: anywhere')
    expect(accessRules).not.toMatch(/\bwidth:\s*\d+px/)
    expect(responsiveCss).toContain('.organization-access__bundle li')
    expect(responsiveCss).toContain('grid-template-columns: 1fr')
  })
})

async function mountAccess(
  overrides: { authenticated?: boolean; context?: OrganizationContext } = {},
) {
  const Host = defineComponent({
    props: {
      authenticated: { type: Boolean, default: overrides.authenticated ?? true },
      context: { type: Object, default: () => overrides.context ?? ownerContext() },
      invalidationRevision: { type: Number, default: 0 },
    },
    async setup(hostProps) {
      await useAuthSession(createApiClient('http://localhost:8788')).initializeAuth(true)
      return () =>
        h(SettingsOrganizationAccess, {
          authenticated: hostProps.authenticated,
          context: hostProps.context as OrganizationContext,
          invalidationRevision: hostProps.invalidationRevision,
        })
    },
  })
  const wrapper = await mountSuspended(Host, {
    attachTo: document.body,
    props: {
      authenticated: overrides.authenticated ?? true,
      context: overrides.context ?? ownerContext(),
      invalidationRevision: 0,
    },
    route: false,
  })
  mountedWrappers.push(wrapper)
  const context = overrides.context ?? ownerContext()
  if (
    (overrides.authenticated ?? true) &&
    context.isOrganizationOwner &&
    context.memberAccess &&
    !context.isBlocked
  ) {
    await vi.waitUntil(() => wrapper.find('.organization-access__catalog').exists())
  }
  return wrapper
}

function installHandlers() {
  queryServer.use(
    http.get('http://localhost:8788/auth/config', () =>
      HttpResponse.json({
        configured: true,
        loginUrl: '/auth/eve/login',
        attachUrl: '/auth/eve/attach',
      }),
    ),
    http.get('http://localhost:8788/auth/session', () =>
      HttpResponse.json({
        authenticated: true,
        account: {
          userId: 'owner-user',
          mainCharacter: { characterId: 1_404_328_063, name: 'Owner Pilot' },
        },
      }),
    ),
    http.get('http://localhost:8788/api/me/cache-admission', () =>
      HttpResponse.json(cacheAdmissionForOrganization('owner-user', 1_404_328_063)),
    ),
    http.get('http://localhost:8788/api/organization/permission-catalog', () => {
      permissionReadCount += 1
      return HttpResponse.json(permissionCatalog())
    }),
    http.get('http://localhost:8788/api/organization/permission-bundles', () => {
      permissionReadCount += 1
      return HttpResponse.json(bundleResponse)
    }),
    http.post('http://localhost:8788/api/organization/permission-profile-preview', () =>
      HttpResponse.json(profilePreview(previewPermissionKey)),
    ),
    http.put(
      'http://localhost:8788/api/organization/permission-bundles/:bundleId',
      async ({ request }) => {
        const body = await request.json()
        bundleRequests.push(body)
        if (saveFails) {
          return HttpResponse.json(
            { code: 'MODULE_PERMISSION_UNAVAILABLE', message: 'Bundle rejected.' },
            { status: 409 },
          )
        }
        return HttpResponse.json({
          bundle: { bundleId: 'bundle-1', ...body, organizationVersion: 1 },
        })
      },
    ),
    http.post('http://localhost:8788/api/organization/permission-bundles', async ({ request }) => {
      const body = await request.json()
      bundleRequests.push(body)
      return HttpResponse.json(
        { bundle: { bundleId: 'bundle-new', ...body, organizationVersion: 1 } },
        { status: 201 },
      )
    }),
  )
}

function permissionCatalog() {
  return {
    permissions: [
      permission('alpha', 'alpha.old', 'Old alpha permission', 'standard'),
      permission('alpha', 'alpha.read', 'Read alpha evidence.', 'sensitive'),
      permission('alpha', 'alpha.changed', 'Changed alpha evidence.', 'sensitive'),
      permission('beta', 'beta.keep', 'Keep beta access.', 'standard'),
    ],
    profiles: [
      {
        publisherPackage: '@example/alpha-manifest',
        moduleId: 'alpha',
        id: 'reviewer',
        label: 'Alpha reviewer',
        description: 'Alpha profile.',
        audiences: ['hr'],
        permissions: ['alpha.read'],
      },
      {
        publisherPackage: '@example/beta-manifest',
        moduleId: 'beta',
        id: 'reviewer',
        label: 'Beta reviewer',
        description: 'Beta profile.',
        audiences: ['member'],
        permissions: ['beta.keep'],
      },
    ],
  }
}

function permission(
  moduleId: 'alpha' | 'beta',
  key: string,
  purpose: string,
  sensitivity: 'standard' | 'sensitive',
) {
  return {
    publisherPackage: `@example/${moduleId}-manifest`,
    moduleId,
    key,
    label: key === 'alpha.read' ? 'Read alpha' : key,
    purpose,
    audiences: moduleId === 'alpha' ? ['hr'] : ['member'],
    sensitivity,
    reviewAllowed: false,
  }
}

function profilePreview(key: string) {
  const declaration = permission('alpha', key, `${key} purpose.`, 'sensitive')
  return {
    profile: {
      publisherPackage: '@example/alpha-manifest',
      moduleId: 'alpha',
      id: 'reviewer',
      label: 'Alpha reviewer',
      description: 'Alpha profile.',
      audiences: ['hr'],
      permissions: [key],
    },
    permissions: [
      {
        input: {
          type: 'module',
          publisherPackage: declaration.publisherPackage,
          moduleId: declaration.moduleId,
          key,
        },
        ...declaration,
      },
    ],
  }
}

function permissionBundles() {
  return {
    bundles: [
      {
        bundleId: '345697a4-df0b-44e7-bf19-f10912c53a27',
        organizationVersion: 1,
        name: 'Operations',
        permissions: [
          {
            entryId: '00000000-0000-4000-8000-000000000001',
            type: 'service',
            key: 'discord.operations',
            reviewAllowed: true,
            available: true,
          },
          availablePermission('alpha', 'alpha.old'),
          availablePermission('beta', 'beta.keep'),
          {
            entryId: '00000000-0000-4000-8000-000000000004',
            type: 'module',
            publisherPackage: '@retired/publisher',
            moduleId: 'retired-module',
            key: 'removed.permission',
            reviewAllowed: false,
            available: false,
          },
        ],
      },
    ],
  }
}

function unavailableBundles() {
  return {
    bundles: [
      {
        bundleId: '345697a4-df0b-44e7-bf19-f10912c53a27',
        organizationVersion: 1,
        name: 'Retained permissions',
        permissions: [
          {
            entryId: '00000000-0000-4000-8000-000000000005',
            type: 'module',
            publisherPackage: '@retired/publisher',
            moduleId: 'retired-module',
            key: 'retired.permission',
            reviewAllowed: false,
            available: false,
          },
          {
            entryId: '00000000-0000-4000-8000-000000000006',
            type: 'module',
            publisherPackage: null,
            moduleId: null,
            key: 'legacy.permission',
            reviewAllowed: false,
            available: false,
          },
        ],
      },
    ],
  }
}

function cleanupBundles() {
  return {
    bundles: [
      {
        bundleId: '345697a4-df0b-44e7-bf19-f10912c53a27',
        organizationVersion: 1,
        name: 'Cleanup',
        permissions: [availablePermission('alpha', 'alpha.read')],
      },
    ],
  }
}

function availablePermission(moduleId: 'alpha' | 'beta', key: string) {
  return {
    entryId:
      key === 'alpha.read'
        ? '00000000-0000-4000-8000-000000000002'
        : key === 'alpha.old'
          ? '00000000-0000-4000-8000-000000000003'
          : '00000000-0000-4000-8000-000000000007',
    type: 'module',
    publisherPackage: `@example/${moduleId}-manifest`,
    moduleId,
    key,
    reviewAllowed: false,
    available: true,
    label: key,
    purpose: `${key} purpose.`,
    audiences: moduleId === 'alpha' ? ['hr'] : ['member'],
    sensitivity: 'standard',
    currentReviewAllowed: false,
  }
}

function ownerContext(): OrganizationContext {
  return {
    organization: {
      organizationType: 'corporation',
      organizationId: 98_000_001,
      organizationName: 'Example Corporation',
      organizationTicker: 'EX',
      organizationVersion: 1,
    },
    isOrganizationOwner: true,
    isBlocked: false,
    memberAccess: true,
    capabilities: { reviewRegistration: true, viewRosterCoverage: true },
    claimAvailable: false,
    ownerStatus: 'fresh',
    ownerFailureClass: null,
    freshUntil: '2026-09-10T13:00:00.000Z',
    graceUntil: null,
    reviewDeadline: null,
    authorityCharacter: null,
  }
}

function button(wrapper: VueWrapper, label: string) {
  const result = wrapper.findAll('button').find((candidate) => candidate.text().includes(label))
  if (!result) throw new Error(`Button not found: ${label}`)
  return result
}

function checkboxForKey(wrapper: VueWrapper, key: string) {
  const label = wrapper
    .findAll('.organization-access__permission')
    .find((candidate) => candidate.text().includes(key))
  if (!label) throw new Error(`Permission not found: ${key}`)
  return label.get('input')
}

function clickDialogButton(label: string) {
  const result = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (candidate) => candidate.textContent?.includes(label),
  )
  if (!result) throw new Error(`Dialog button not found: ${label}`)
  result.click()
}
