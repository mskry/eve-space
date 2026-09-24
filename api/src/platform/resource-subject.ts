import type { PlatformResourceSubject } from '@eve-space/platform-module-contract/resources'

export function toPlatformResourceSubject(input: {
  subjectKind: 'deployment' | 'character' | 'corporation' | 'alliance'
  subjectId: string
  subjectLifecycleId: string
}): PlatformResourceSubject | null {
  const id = Number(input.subjectId)
  if (!Number.isSafeInteger(id) || id <= 0) {
    return null
  }
  if (input.subjectKind === 'deployment') {
    return { deploymentId: id, kind: 'deployment', lifecycleId: input.subjectLifecycleId }
  }
  if (input.subjectKind === 'character') {
    return { characterId: id, kind: 'character', lifecycleId: input.subjectLifecycleId }
  }
  if (input.subjectKind === 'corporation') {
    return { corporationId: id, kind: 'corporation', lifecycleId: input.subjectLifecycleId }
  }
  return { allianceId: id, kind: 'alliance', lifecycleId: input.subjectLifecycleId }
}
