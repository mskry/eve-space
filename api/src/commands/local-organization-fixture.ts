import { createDeployment } from '../admin/store.js'
import { findOwnedCharacter, saveLogin } from '../auth/character-lifecycle.js'
import { findCharacterCacheAuthorizationForLifecycle } from '../auth/character-token-store.js'
import { createOpaqueToken, hashPassword } from '../auth/security.js'
import { findSession } from '../auth/session-store.js'
import { sql } from '../db/client.js'
import { installedModuleResources } from '../generated/platform/installed-module-worker.js'
import { registerOrganizationCorporationSource } from '../organization/corporation-sources.js'
import {
  createOrganizationGroup,
  createOrganizationPermissionBundle,
} from '../organization/group-store.js'
import { claimOrganizationOwnership } from '../organization/owner-claim.js'
import { updateOrganizationRegistrationPolicy } from '../organization/policy-store.js'
import { grantOrganizationRole } from '../organization/role-store.js'
import { coreResources } from '../platform/core-resources.js'
import { findInstalledResource } from '../platform/resource-identity.js'
import {
  resolveInstalledResourceEligibility,
  selectDueInstalledResources,
} from '../platform/resource-eligibility.js'
import { applyInstalledResourceObservation } from '../platform/resource-refresh.js'
import { toPlatformResourceSubject } from '../platform/resource-subject.js'
import { platformResources } from '../platform/resources.js'

export const localOrganizationFixture = {
  adminEmail: 'fixture-admin@localhost',
  adminPassword: 'eve-space-fixture',
  corporationId: 98_000_001,
  corporationName: 'EVE Space Fixture Corporation',
  corporationTicker: 'ESFIX',
  directorCharacterId: 90_000_001,
  directorCharacterName: 'Fixture Director',
  unregisteredCharacterId: 90_000_002,
} as const

export const localOrganizationFixtureScopes = [
  'esi-characters.read_corporation_roles.v1',
  'esi-corporations.read_corporation_membership.v1',
  'esi-characters.read_freelance_jobs.v1',
  'esi-corporations.read_freelance_jobs.v1',
  'esi-corporations.read_projects.v1',
  'esi.activity.char:read',
] as const

const fixtureLockId = 2_026_090_008
const organizationVersion = 1
const activityIds = {
  campaign: '33333333-3333-4333-8333-333333333333',
  job: '22222222-2222-4222-8222-222222222222',
  objective: '44444444-4444-4444-8444-444444444444',
  project: '11111111-1111-4111-8111-111111111111',
} as const

export interface LocalOrganizationFixtureSummary {
  readonly organizationVersion: number
  readonly corporationId: number
  readonly directorCharacterId: number
  readonly unregisteredCharacterId: number
  readonly userId: string
  readonly seededResourceCount: number
}

export interface LocalOrganizationFixtureOptions {
  readonly deliverSession: (sessionToken: string) => Promise<void>
}

export async function seedLocalOrganizationFixture({
  deliverSession,
}: LocalOrganizationFixtureOptions): Promise<LocalOrganizationFixtureSummary> {
  const lockConnection = await sql.reserve()
  try {
    await lockConnection`select pg_advisory_lock(${fixtureLockId})`
    await assertFixtureDatabaseEmpty()
    const now = new Date()
    const sessionExpiresAt = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    const applicationSessionToken = createOpaqueToken()

    await createDeployment({
      email: localOrganizationFixture.adminEmail,
      organization: {
        id: localOrganizationFixture.corporationId,
        name: localOrganizationFixture.corporationName,
        ticker: localOrganizationFixture.corporationTicker,
        type: 'corporation',
      },
      passwordHash: await hashPassword(localOrganizationFixture.adminPassword),
      sessionExpiresAt,
      sessionToken: createOpaqueToken(),
    })
    await saveLogin({
      accessToken: createOpaqueToken(),
      affiliationCheckedAt: now,
      allianceId: null,
      characterId: localOrganizationFixture.directorCharacterId,
      characterName: localOrganizationFixture.directorCharacterName,
      corporationId: localOrganizationFixture.corporationId,
      expiresIn: 8 * 60 * 60,
      ownerHash: 'local-organization-fixture-owner',
      refreshToken: createOpaqueToken(),
      scopes: [...localOrganizationFixtureScopes],
      sessionExpiresAt,
      sessionToken: applicationSessionToken,
    })
    const account = await findSession(applicationSessionToken)
    if (!account) {
      throw new Error('Local organization fixture session was not persisted')
    }
    const character = await findOwnedCharacter(
      account.userId,
      localOrganizationFixture.directorCharacterId,
    )
    if (!character) {
      throw new Error('Local organization fixture character was not persisted')
    }
    const authorization = await findCharacterCacheAuthorizationForLifecycle(
      localOrganizationFixture.directorCharacterId,
      character.subjectLifecycleId,
    )
    if (!authorization) {
      throw new Error('Local organization fixture authorization was not persisted')
    }

    await claimOrganizationOwnership({
      affiliationCheckedAt: now,
      authorityCorporationId: localOrganizationFixture.corporationId,
      authorizationGeneration: authorization.tokenVersion,
      characterId: localOrganizationFixture.directorCharacterId,
      evidenceAuthorizationGeneration: authorization.tokenVersion,
      evidenceFreshUntil: sessionExpiresAt,
      observedAllianceId: null,
      observedCorporationId: localOrganizationFixture.corporationId,
      organizationId: localOrganizationFixture.corporationId,
      organizationVersion,
      requiredScope: 'esi-characters.read_corporation_roles.v1',
      roleEvidenceRevision: now.toISOString(),
      subjectLifecycleId: character.subjectLifecycleId,
      userId: account.userId,
    })
    await updateOrganizationRegistrationPolicy({
      actorUserId: account.userId,
      authorityEvidenceFreshDurationSeconds: 3600,
      derivedDirectorAuthorityEnabled: true,
      reason: 'Establish the local organization fixture registration policy.',
      requiredScopes: [...localOrganizationFixtureScopes],
      staleEvidenceGraceDurationSeconds: 86_400,
      strictRemediationDurationSeconds: 86_400,
    })
    await grantOrganizationRole({
      actorUserId: account.userId,
      reason: 'Exercise local HR authorization.',
      role: 'hr_auditor',
      targetUserId: account.userId,
    })
    await grantOrganizationRole({
      actorUserId: account.userId,
      reason: 'Exercise local director authorization.',
      role: 'director',
      targetUserId: account.userId,
    })
    const bundle = await createOrganizationPermissionBundle({
      actorUserId: account.userId,
      name: 'Organization Activity Members',
      permissions: [
        {
          type: 'module',
          publisherPackage: '@eve-space/organization-activity-manifest',
          moduleId: 'organization-activity',
          key: 'organization-activity.view',
        },
      ],
      reason: 'Create the local organization activity permission bundle.',
    })
    await createOrganizationGroup({
      actorUserId: account.userId,
      bundleIds: [bundle.bundleId],
      complianceSource: 'core.registration',
      managementMode: 'compliance',
      name: 'Registered Members',
      restricted: false,
    })
    await registerOrganizationCorporationSource(
      {
        actorUserId: account.userId,
        characterId: localOrganizationFixture.directorCharacterId,
        corporationId: localOrganizationFixture.corporationId,
      },
      {
        evidence: {
          affiliation: {
            affiliationCheckedAt: now,
            affiliationFreshUntil: sessionExpiresAt,
            allianceId: null,
            characterId: localOrganizationFixture.directorCharacterId,
            corporationId: localOrganizationFixture.corporationId,
            stale: false,
          },
          roles: {
            authorizationGeneration: authorization.tokenVersion,
            freshUntil: sessionExpiresAt,
            observedAt: now,
            roleEvidenceRevision: now.toISOString(),
            roles: ['Director'],
            rolesAtBase: [],
            rolesAtHeadquarters: [],
            rolesAtOther: [],
            stale: false,
          },
        },
      },
    )

    const seededResourceCount = await seedFixtureResources(new Date())
    await deliverSession(applicationSessionToken)
    return {
      corporationId: localOrganizationFixture.corporationId,
      directorCharacterId: localOrganizationFixture.directorCharacterId,
      organizationVersion,
      seededResourceCount,
      unregisteredCharacterId: localOrganizationFixture.unregisteredCharacterId,
      userId: account.userId,
    }
  } finally {
    try {
      await lockConnection`select pg_advisory_unlock(${fixtureLockId})`
    } finally {
      lockConnection.release()
    }
  }
}

async function assertFixtureDatabaseEmpty() {
  const [state] = await sql<{ populated: boolean }[]>`
    select
      exists(select 1 from deployment_settings)
      or exists(select 1 from deployment_admins)
      or exists(select 1 from users)
      or exists(select 1 from characters)
      or exists(select 1 from platform_subject_lifecycles)
      or exists(select 1 from domain_events)
      or exists(select 1 from eve_module_organization_activity.activity_snapshots)
      or exists(select 1 from eve_module_organization_activity.collection_checkpoints)
      as populated
  `
  if (state?.populated) {
    throw new Error('Local organization fixtures require an empty disposable database')
  }
}

async function seedFixtureResources(validatedAt: Date) {
  const due = await selectDueInstalledResources({ limit: 100 })
  const fixtureResources = [
    coreResources.find(({ resourceId }) => resourceId === 'corporation-roster')!,
    ...installedModuleResources.filter((resource) =>
      due.some(
        ({ identity }) =>
          identity.moduleId === resource.moduleId && identity.resourceId === resource.resourceId,
      ),
    ),
  ]
  await Promise.all(
    fixtureResources.map(async (resource) => {
      const planned = due.find(
        ({ identity }) =>
          identity.moduleId === resource.moduleId && identity.resourceId === resource.resourceId,
      )
      if (!planned) {
        throw new Error(`Local fixture resource ${resource.resourceId} is not due`)
      }
      const installed = findInstalledResource(planned.identity, platformResources)
      const subject = toPlatformResourceSubject(planned.identity)
      if (!installed || !subject) {
        throw new Error(`Local fixture resource ${resource.resourceId} is unavailable`)
      }
      const eligibility = await resolveInstalledResourceEligibility(planned.identity)
      if (eligibility.status !== 'eligible' || !eligibility.due) {
        throw new Error(`Local fixture resource ${resource.resourceId} is ineligible`)
      }

      try {
        await applyInstalledResourceObservation({
          authorizationCharacterId: eligibility.authorizationCharacterId,
          authorizationCharacterLifecycleId: eligibility.authorizationCharacterLifecycleId,
          authorizationGeneration: eligibility.authorizationGeneration,
          complete: true,
          data:
            resource.moduleId === 'core'
              ? [
                  localOrganizationFixture.directorCharacterId,
                  localOrganizationFixture.unregisteredCharacterId,
                ]
              : activityObservation(resource.resourceId, validatedAt),
          identity: planned.identity,
          managedAuthority: eligibility.managedAuthority,
          organizationVersion,
          outcome: 'complete',
          resource: installed,
          subject,
          validatedAt: validatedAt.toISOString(),
        })
      } catch (error) {
        throw new Error(`Local fixture resource ${resource.resourceId} failed`, { cause: error })
      }
    }),
  )
  return fixtureResources.length
}

function activityObservation(resourceId: string, validatedAt: Date) {
  const snapshots = snapshotsForResource(resourceId, validatedAt)
  return {
    checkpoint: {
      cursors: {},
      initialized: true,
      requests: [],
      retainedCampaignIds: [activityIds.campaign],
      retainedIds: snapshots.map(({ snapshot }) => snapshot.id),
    },
    expectedRevision: 0,
    organizationVersion,
    resourceId,
    snapshots,
  }
}

function snapshotsForResource(resourceId: string, validatedAt: Date) {
  const timestamp = validatedAt.toISOString()
  const deadline = new Date(validatedAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const project = {
    campaignId: null,
    committed: null,
    contributed: null,
    corporationId: localOrganizationFixture.corporationId,
    deadline,
    description: 'Deliver production materials for the fixture corporation.',
    eligibility: 'unrestricted' as const,
    id: activityIds.project,
    kind: 'project' as const,
    objective: 'Deliver materials',
    progress: { current: 40, desired: 100 },
    reward: { initial: 1_000_000, remaining: 600_000 },
    state: 'Active',
    title: 'Fixture Logistics Project',
  }
  const job = {
    ...project,
    id: activityIds.job,
    kind: 'job' as const,
    objective: 'Haul supplies',
    progress: { current: 5, desired: 20 },
    title: 'Fixture Hauling Job',
  }
  const campaign = {
    ...project,
    corporationId: null,
    description: null,
    id: activityIds.campaign,
    kind: 'campaign' as const,
    objective: null,
    progress: { current: 0.25, desired: 1 },
    reward: null,
    title: 'Fixture Military Campaign',
  }
  const objective = {
    ...campaign,
    campaignId: activityIds.campaign,
    id: activityIds.objective,
    kind: 'objective' as const,
    objective: 'Secure the objective',
    title: 'Fixture Campaign Objective',
  }
  let selected
  switch (resourceId) {
    case 'campaigns':
      selected = [campaign, objective]
      break
    case 'public-jobs':
    case 'corporation-jobs':
      selected = [job]
      break
    case 'corporation-projects':
      selected = [project]
      break
    case 'character-jobs':
      selected = [{ ...job, committed: true, contributed: 5 }]
      break
    case 'character-campaigns':
      selected = [{ ...objective, committed: true, contributed: 0.1 }]
      break
    case 'character-projects':
      selected = [{ ...project, committed: true, contributed: 40 }]
      break
    default:
      throw new Error(`Unsupported local fixture resource ${resourceId}`)
  }
  return selected.map((snapshot) => ({ replace: true, snapshot, validatedAt: timestamp }))
}
