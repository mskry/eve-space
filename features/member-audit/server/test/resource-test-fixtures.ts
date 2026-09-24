import type {
  PlatformCharacterResourceSubject,
  PlatformResourceMaintenanceContext,
  PlatformResourceMaterializationContext,
} from '@eve-space/platform-module-contract/resources'
import type { PlatformModuleLogger } from '@eve-space/platform-module-contract/server'
import { vi } from 'vitest'

export const subject: PlatformCharacterResourceSubject = {
  characterId: 90_000_001,
  kind: 'character',
  lifecycleId: '11111111-1111-4111-8111-111111111111',
}

const logger = {
  error: vi.fn<PlatformModuleLogger['error']>(),
  info: vi.fn<PlatformModuleLogger['info']>(),
  warn: vi.fn<PlatformModuleLogger['warn']>(),
} satisfies PlatformModuleLogger

export function materializationContext<Data, Persistence extends object>(
  data: Data,
  persistence: Persistence,
): PlatformResourceMaterializationContext<Data, PlatformCharacterResourceSubject, Persistence> {
  return {
    authorizationGeneration: 8,
    capabilities: { logger, persistence },
    data,
    managedAuthority: {
      disclosureVersion: 2,
      managedMemberLifecycleId: '33333333-3333-4333-8333-333333333333',
      organizationDeploymentId: 1,
      organizationVersion: 4,
      sectionActivationVersion: 3,
      sectionId: 'skills',
      targetUserId: '22222222-2222-4222-8222-222222222222',
    },
    organizationVersion: 4,
    subject,
    validatedAt: '2026-09-17T10:00:00Z',
  }
}

export function maintenanceContext<Persistence extends object>(
  persistence: Persistence,
): PlatformResourceMaintenanceContext<Persistence> {
  return {
    capabilities: { logger, persistence },
    invalidAuthorities: [],
    now: '2026-09-18T10:00:00.000Z',
    purgeAccountIds: [],
    purgeRetention: false,
  }
}
