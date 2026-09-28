import type { PlatformReviewerPanelProps } from '@eve-space/platform-module-nuxt/runtime/reviewer-panel'
import { effectScope, reactive } from 'vue'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useMemberAuditManagementAction } from '../src/runtime/app/reviewer/useMemberAuditManagementAction.js'

const { invalidateQueries } = vi.hoisted(() => ({ invalidateQueries: vi.fn() }))
vi.mock('@pinia/colada', () => ({ useQueryCache: () => ({ invalidateQueries }) }))

const scopes: ReturnType<typeof effectScope>[] = []

beforeEach(() => {
  invalidateQueries.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  for (const scope of scopes) scope.stop()
  scopes.length = 0
})

const createAction = (
  refresh = vi.fn().mockResolvedValue(undefined),
  clearForm = vi.fn(),
  invalidateReviewerAccess?: () => Promise<void>,
) => {
  const queryAccess = reactive({ authenticated: true, authorized: true, moduleEnabled: true })
  const props = reactive<PlatformReviewerPanelProps>({
    contributionId: 'member-block',
    moduleId: 'member-audit',
    organizationVersion: 4,
    queryAccess,
    routeId: 'block-actions',
    sectionId: 'access-management',
    target: {
      kind: 'managed-organization-account',
      managedMemberLifecycleId: '33333333-3333-4333-8333-333333333333',
      sectionActivationVersion: 1,
      userId: '22222222-2222-4222-8222-222222222222',
    },
  })
  const scope = effectScope()
  scopes.push(scope)
  const action = scope.run(() =>
    useMemberAuditManagementAction(props, refresh, clearForm, invalidateReviewerAccess),
  )!
  return { action, clearForm, queryAccess, refresh }
}

test('clears the form and refreshes reviewer data after an authorized action', async () => {
  const { action, clearForm, refresh } = createAction()
  const request = vi.fn().mockResolvedValue(undefined)

  await action.run(request, 'Account blocked.', 'Block failed.')

  expect(request).toHaveBeenCalledOnce()
  expect(clearForm).toHaveBeenCalledOnce()
  expect(action.message.value).toBe('Account blocked.')
  expect(action.pending.value).toBe(false)
  expect(refresh).toHaveBeenCalledOnce()
  expect(invalidateQueries).toHaveBeenCalledWith({
    key: ['private', 'organization', 'reviewer', 4],
  })
})

test('uses the host invalidation seam instead of local refresh when provided', async () => {
  const invalidateReviewerAccess = vi.fn().mockResolvedValue(undefined)
  const { action, refresh } = createAction(undefined, undefined, invalidateReviewerAccess)

  await action.run(vi.fn().mockResolvedValue(undefined), 'Group assigned.', 'Assignment failed.')

  expect(invalidateReviewerAccess).toHaveBeenCalledOnce()
  expect(refresh).not.toHaveBeenCalled()
  expect(invalidateQueries).not.toHaveBeenCalled()
  expect(action.message.value).toBe('Group assigned.')
})

test('does not submit twice or publish results after the target loses authority', async () => {
  let resolveRequest!: () => void
  const request = vi.fn(() => new Promise<void>((resolve) => (resolveRequest = resolve)))
  const { action, clearForm, queryAccess, refresh } = createAction()

  const running = action.run(request, 'Account blocked.', 'Block failed.')
  expect(action.pending.value).toBe(true)
  await action.run(request, 'Account blocked.', 'Block failed.')
  expect(request).toHaveBeenCalledOnce()

  queryAccess.authorized = false
  expect(action.authorized.value).toBe(false)
  expect(action.pending.value).toBe(false)
  expect(clearForm).toHaveBeenCalledOnce()
  resolveRequest()
  await running

  expect(action.message.value).toBe('')
  expect(refresh).not.toHaveBeenCalled()
  await action.run(request, 'Account blocked.', 'Block failed.')
  expect(request).toHaveBeenCalledOnce()
})

test('reports a failed action without clearing the form or invalidating reviewer data', async () => {
  const { action, clearForm, refresh } = createAction()

  await action.run(vi.fn().mockRejectedValue(new Error('Context changed')), 'Done.', 'Failed.')

  expect(action.message.value).toBe('Context changed')
  expect(action.pending.value).toBe(false)
  expect(clearForm).not.toHaveBeenCalled()
  expect(refresh).not.toHaveBeenCalled()
  expect(invalidateQueries).not.toHaveBeenCalled()
})

test('keeps success visible when the follow-up refresh fails', async () => {
  const invalidateReviewerAccess = vi.fn().mockRejectedValue(new Error('Network failed'))
  const { action, clearForm } = createAction(undefined, undefined, invalidateReviewerAccess)

  await action.run(vi.fn().mockResolvedValue(undefined), 'Account blocked.', 'Block failed.')

  expect(clearForm).toHaveBeenCalledOnce()
  expect(action.message.value).toBe('Account blocked. Refresh review data to see the latest state.')
  expect(action.pending.value).toBe(false)
})
