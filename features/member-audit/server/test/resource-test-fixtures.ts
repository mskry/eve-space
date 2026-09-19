import type {
  PlatformCharacterResourceSubject,
  PlatformResourceMaintenanceContext,
  PlatformResourceMaterializationContext,
} from '@eve-space/platform-module-contract/resources'
import type { PlatformModuleLogger } from '@eve-space/platform-module-contract/server'
import { vi } from 'vitest'

export const subject: PlatformCharacterResourceSubject = {
  kind: 'character',
  characterId: 90_000_001,
  lifecycleId: '11111111-1111-4111-8111-111111111111',
}

const logger = {
  info: vi.fn<PlatformModuleLogger['info']>(),
  warn: vi.fn<PlatformModuleLogger['warn']>(),
  error: vi.fn<PlatformModuleLogger['error']>(),
} satisfies PlatformModuleLogger

export function materializationContext<Data, Persistence extends object>(
  data: Data,
  persistence: Persistence,
): PlatformResourceMaterializationContext<Data, PlatformCharacterResourceSubject, Persistence> {
  return {
    subject,
    data,
    validatedAt: '2026-09-17T10:00:00Z',
    authorizationGeneration: 8,
    organizationVersion: 4,
    managedAuthority: {
      organizationDeploymentId: 1,
      organizationVersion: 4,
      targetUserId: '22222222-2222-4222-8222-222222222222',
      managedMemberLifecycleId: '33333333-3333-4333-8333-333333333333',
      sectionId: 'skills',
      disclosureVersion: 2,
      sectionActivationVersion: 3,
    },
    capabilities: { logger, persistence },
  }
}

export function maintenanceContext<Persistence extends object>(
  persistence: Persistence,
): PlatformResourceMaintenanceContext<Persistence> {
  return {
    now: '2026-09-18T10:00:00.000Z',
    purgeAccountIds: [],
    invalidAuthorities: [],
    purgeRetention: false,
    capabilities: { logger, persistence },
  }
}
