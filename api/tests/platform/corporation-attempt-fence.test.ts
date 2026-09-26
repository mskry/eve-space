import type {
  PlatformCorporationResourceSubject,
  PlatformResourceCollectionContext,
} from '@eve-space/platform-module-contract/resources'
import { describe, expect, test, vi } from 'vitest'
import type { PlatformEsiOperationProtocol } from '../../src/esi-gateway/catalog-interface.js'
import { executeInstalledResourceOperation } from '../../src/platform/resource-operation-executor.js'
import { processInstalledResourceRefresh } from '../../src/platform/resource-refresh.js'
import { platformResources } from '../../src/platform/resources.js'

type CorporationContext = PlatformResourceCollectionContext<
  PlatformCorporationResourceSubject,
  PlatformEsiOperationProtocol<'organization-activity-corporation-jobs'>
>

describe('corporation reconciliation authority', () => {
  test('drops a changed role revision without overwriting the original attempt fence or recording failure', async () => {
    const installed = platformResources.find(
      (resource) =>
        resource.moduleId === 'organization-activity' && resource.resourceId === 'corporation-jobs',
    )!
    const resource = {
      ...installed,
      implementation: {
        mode: 'bounded-collection' as const,
        operation: installed.operationId,
        collect: async (context: CorporationContext) => ({
          complete: true,
          data: await context.operations['organization-activity-corporation-jobs']({
            path: { corporation_id: 98_000_001 },
          }),
        }),
        materialize: vi.fn(),
      },
    }
    const identity = {
      moduleId: resource.moduleId,
      resourceId: resource.resourceId,
      subjectKind: 'corporation' as const,
      subjectId: '98000001',
      subjectLifecycleId: '1cfba895-359c-4a48-b21a-177d351c87a6',
    }
    const fence = {
      sourceId: 'd56315c7-6bfb-462d-a8fa-0e1588a6312a',
      organizationVersion: 2,
      corporationLifecycleId: identity.subjectLifecycleId,
      corporationId: 98_000_001,
      characterId: 1_404_328_063,
      characterLifecycleId: '70eb0397-adff-4a82-94d6-065bd2149ea8',
      affiliationPeriodRevision: '43e4b829-a09a-4e34-a91e-e414c5f58fe1',
      authorizationGeneration: 7,
      requirementsFingerprint: 'jobs-v1',
      roleRevision: 'revision-1',
    }
    const ready = {
      outcome: 'ready' as const,
      resource,
      subject: {
        kind: 'corporation' as const,
        corporationId: 98_000_001,
        lifecycleId: identity.subjectLifecycleId,
      },
      authorization: { tokenVersion: 7 },
      authorizationCharacterId: fence.characterId,
      authorizationCharacterLifecycleId: fence.characterLifecycleId,
      managedAuthority: null,
      corporationAuthorityFence: fence,
    }
    const guardExecution = vi
      .fn()
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce({
        ...ready,
        corporationAuthorityFence: { ...fence, roleRevision: 'revision-2' },
      })
    const observedAuthorities: unknown[] = []
    const executeEsiOperation = vi.fn()
    const recordFailure = vi.fn()
    const applyObservation = vi.fn()

    await expect(
      processInstalledResourceRefresh(identity, {
        executeOperation: (currentIdentity, options) =>
          executeInstalledResourceOperation(currentIdentity, {
            ...options,
            resources: [resource],
            guardExecution,
            createCapabilities: vi.fn().mockReturnValue({}),
            loadCollectionContext: vi
              .fn()
              .mockResolvedValue({ corporationId: 98_000_001, organizationVersion: 2 }),
            executeEsiOperation,
            onAuthorityResolved(authority) {
              observedAuthorities.push(authority)
              options?.onAuthorityResolved?.(authority)
            },
          }),
        recordFailure,
        applyObservation,
      }),
    ).resolves.toBeUndefined()

    expect(observedAuthorities).toHaveLength(1)
    expect(observedAuthorities[0]).toMatchObject({ corporationAuthorityFence: fence })
    expect(guardExecution).toHaveBeenCalledTimes(2)
    expect(executeEsiOperation).not.toHaveBeenCalled()
    expect(recordFailure).not.toHaveBeenCalled()
    expect(applyObservation).not.toHaveBeenCalled()
  })
})
