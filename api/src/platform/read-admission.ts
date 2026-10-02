import type { PlatformAuthorizedOrganizationContext } from '@eve-space/platform-module-contract/server'
import type { PlatformInstalledOrganizationContributionAuthorization } from '@eve-space/platform-module-contract/installed'
import { assertReadAdmission, type ReadAdmissionDenial } from '../auth/read-policy.js'
import {
  admitOwnedRead,
  sessionAdmissionDenial,
  type OwnedReadBinding,
} from '../auth/read-admission.js'
import type { ReadAdmissionWork } from '../auth/read-work.js'
import type { SessionAccount } from '../auth/session-store.js'
import { admitOrganizationRead } from '../organization/read-admission.js'
import { loadOrganizationSessionContext } from '../organization/session-context.js'
import { moduleReadEnablementDenial } from './read-enablement.js'

type ModuleReadStrategy =
  | 'public'
  | 'authenticated-session'
  | 'owned-character'
  | 'organization-member'

export interface ModuleReadPolicy {
  readonly moduleId: string
  readonly contributionId: string
  readonly readId: string
  readonly sectionId?: string
  readonly strategy: ModuleReadStrategy
  readonly organization?: PlatformInstalledOrganizationContributionAuthorization
  readonly requiredScope?: string
}

export interface ModuleReadBinding {
  readonly policy: ModuleReadPolicy
  readonly userId: string | null
  readonly organization: PlatformAuthorizedOrganizationContext | null
  readonly owned: OwnedReadBinding | null
}

export type ModuleReadAdmission =
  | ReadAdmissionDenial
  | {
      readonly admitted: true
      readonly binding: ModuleReadBinding
    }

const freezePolicy = (policy: ModuleReadPolicy): ModuleReadPolicy =>
  Object.freeze({
    ...policy,
    ...(policy.organization && {
      organization: Object.freeze({
        ...policy.organization,
        ...(policy.organization.additionalRequiredPermissions && {
          additionalRequiredPermissions: Object.freeze([
            ...policy.organization.additionalRequiredPermissions,
          ]),
        }),
      }),
    }),
  })

const admitModuleOrganization = async (
  policy: ModuleReadPolicy,
  session: SessionAccount | null,
  work?: ReadAdmissionWork,
) => {
  if (!policy.organization) return null
  const load = () => loadOrganizationSessionContext(session!.userId)
  const organization = work ? await work.run(load) : await load()
  const authorize = () => admitOrganizationRead(session, organization, policy.organization!)
  return work ? work.run(authorize) : authorize()
}

const assertModuleReadPolicy = (policy: ModuleReadPolicy): void => {
  const strategies: readonly ModuleReadStrategy[] = [
    'public',
    'authenticated-session',
    'owned-character',
    'organization-member',
  ]
  if (!strategies.includes(policy.strategy)) throw new Error('Unsupported module read strategy')
  if (policy.strategy === 'public' && (policy.organization || policy.requiredScope)) {
    throw new Error('Public read cannot carry protected authority')
  }
  if (policy.strategy === 'organization-member' && !policy.organization) {
    throw new Error('Organization read requires a declared policy')
  }
  if (policy.organization && policy.organization.moduleId !== policy.moduleId) {
    throw new Error('Organization read policy has a different module owner')
  }
  if (policy.requiredScope && policy.strategy !== 'owned-character') {
    throw new Error('EVE scope requires an exact owned-character read')
  }
}

export const admitModuleRead = async (
  declaration: ModuleReadPolicy,
  session: SessionAccount | null,
  characterId?: number,
  work?: ReadAdmissionWork,
): Promise<ModuleReadAdmission> => {
  const policy = freezePolicy(declaration)
  assertModuleReadPolicy(policy)
  const disabled = await moduleReadEnablementDenial(policy.moduleId, policy.sectionId)
  if (disabled) return disabled
  const userId = policy.strategy === 'public' ? null : (session?.userId ?? null)
  if (policy.strategy !== 'public') {
    const denial = sessionAdmissionDenial(session)
    if (denial) return denial
  }
  const organization = await admitModuleOrganization(policy, session, work)
  if (organization && !organization.admitted) return organization
  let owned: OwnedReadBinding | null = null
  if (policy.strategy === 'owned-character') {
    if (!Number.isSafeInteger(characterId) || characterId! <= 0) {
      throw new TypeError('Owned read requires a validated exact character identity')
    }
    const admission = await admitOwnedRead(session, characterId!, policy.requiredScope, work)
    if (!admission.admitted) return admission
    owned = admission.binding
  }
  return {
    admitted: true,
    binding: Object.freeze({
      policy,
      userId,
      owned,
      organization: organization?.admitted ? organization.organization : null,
    }),
  }
}

const recheckModuleRead = async (
  binding: ModuleReadBinding,
  session: SessionAccount | null,
  work?: ReadAdmissionWork,
): Promise<ReadAdmissionDenial | null> => {
  const admission = await admitModuleRead(
    binding.policy,
    session,
    binding.owned?.character.characterId,
    work,
  )
  if (!admission.admitted) return admission
  const ownedChanged =
    binding.owned &&
    (binding.owned.character.subjectLifecycleId !==
      admission.binding.owned?.character.subjectLifecycleId ||
      binding.owned.authorizationRevision !== admission.binding.owned?.authorizationRevision)
  if (
    binding.userId !== admission.binding.userId ||
    ownedChanged ||
    JSON.stringify(binding.organization) !== JSON.stringify(admission.binding.organization)
  )
    return {
      admitted: false,
      status: 409,
      body: {
        code: 'READ_AUTHORIZATION_CHANGED',
        message: 'Read authorization changed. Restart this read.',
      },
    }
  return null
}

export const createModuleReadGuard = (
  binding: ModuleReadBinding,
  liveSession: (work?: ReadAdmissionWork) => Promise<SessionAccount | null>,
  work?: ReadAdmissionWork,
) =>
  Object.freeze({
    identity: JSON.stringify([
      binding.policy.moduleId,
      binding.policy.contributionId,
      binding.policy.readId,
      binding.policy.sectionId ?? null,
      binding.policy.strategy,
      binding.policy.requiredScope ?? null,
      binding.userId,
      binding.organization,
      binding.owned?.character.characterId ?? null,
      binding.owned?.character.subjectLifecycleId ?? null,
      binding.owned?.authorizationRevision ?? null,
    ]),
    assertCurrent: async (checkWork: ReadAdmissionWork | undefined = work) =>
      assertReadAdmission(
        await recheckModuleRead(
          binding,
          binding.userId === null ? null : await liveSession(checkWork),
          checkWork,
        ),
      ),
  })
