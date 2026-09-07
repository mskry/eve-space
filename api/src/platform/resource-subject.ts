import type { PlatformResourceSubject } from '@eve-space/platform-module-contract'

export function toPlatformResourceSubject(input: {
  subjectKind: 'deployment' | 'character' | 'corporation' | 'alliance'
  subjectId: string
  subjectLifecycleId: string
}): PlatformResourceSubject | null {
  const id = Number(input.subjectId)
  if (!Number.isSafeInteger(id) || id <= 0) return null
  if (input.subjectKind === 'deployment')
    return { kind: 'deployment', deploymentId: id, lifecycleId: input.subjectLifecycleId }
  if (input.subjectKind === 'character')
    return { kind: 'character', characterId: id, lifecycleId: input.subjectLifecycleId }
  if (input.subjectKind === 'corporation')
    return { kind: 'corporation', corporationId: id, lifecycleId: input.subjectLifecycleId }
  return { kind: 'alliance', allianceId: id, lifecycleId: input.subjectLifecycleId }
}
