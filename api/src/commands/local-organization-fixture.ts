import { createDeployment } from '../admin/store.js'
import { findOwnedCharacter, saveLogin } from '../auth/character-lifecycle.js'
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
  corporationId: 98_000_001,
  corporationName: 'EVE Space Fixture Corporation',
  corporationTicker: 'ESFIX',
  directorCharacterId: 90_000_001,
  directorCharacterName: 'Fixture Director',
  unregisteredCharacterId: 90_000_002,
  adminEmail: 'fixture-admin@localhost',
  adminPassword: 'eve-space-fixture',
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
  project: '11111111-1111-4111-8111-111111111111',
  job: '22222222-2222-4222-8222-222222222222',
  campaign: '33333333-3333-4333-8333-333333333333',
  objective: '44444444-4444-4444-8444-444444444444',
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
    const sessionExpiresAt = new Date(now.getTime() + 8 * 60 * 60 * 1_000)
    const applicationSessionToken = createOpaqueToken()

    await createDeployment({
      email: localOrganizationFixture.adminEmail,
      passwordHash: await hashPassword(localOrganizationFixture.adminPassword),
      sessionToken: createOpaqueToken(),
      sessionExpiresAt,
      organization: {
        type: 'corporation',
        id: localOrganizationFixture.corporationId,
        name: localOrganizationFixture.corporationName,
        ticker: localOrganizationFixture.corporationTicker,
      },
    })
    await saveLogin({
      characterId: localOrganizationFixture.directorCharacterId,
      characterName: localOrganizationFixture.directorCharacterName,
      corporationId: localOrganizationFixture.corporationId,
      allianceId: null,
      affiliationCheckedAt: now,
      accessToken: createOpaqueToken(),
      refreshToken: createOpaqueToken(),
      expiresIn: 8 * 60 * 60,
      scopes: [...localOrganizationFixtureScopes],
      sessionToken: applicationSessionToken,
      sessionExpiresAt,
    })
    const account = await findSession(applicationSessionToken)
    if (!account) throw new Error('Local organization fixture session was not persisted')
    const character = await findOwnedCharacter(
      account.userId,
      localOrganizationFixture.directorCharacterId,
    )
    if (!character) throw new Error('Local organization fixture character was not persisted')

    await claimOrganizationOwnership({
      userId: account.userId,
      characterId: localOrganizationFixture.directorCharacterId,
      subjectLifecycleId: character.subjectLifecycleId,
      organizationId: localOrganizationFixture.corporationId,
      organizationVersion,
      authorityCorporationId: localOrganizationFixture.corporationId,
      observedCorporationId: localOrganizationFixture.corporationId,
      observedAllianceId: null,
      affiliationCheckedAt: now,
      requiredScope: 'esi-characters.read_corporation_roles.v1',
    })
    await updateOrganizationRegistrationPolicy({
      actorUserId: account.userId,
      requiredScopes: [...localOrganizationFixtureScopes],
      strictRemediationDurationSeconds: 86_400,
      staleEvidenceGraceDurationSeconds: 86_400,
      reason: 'Establish the local organization fixture registration policy.',
    })
    await grantOrganizationRole({
      actorUserId: account.userId,
      targetUserId: account.userId,
      role: 'hr_auditor',
      reason: 'Exercise local HR authorization.',
    })
    await grantOrganizationRole({
      actorUserId: account.userId,
      targetUserId: account.userId,
      role: 'director',
      reason: 'Exercise local director authorization.',
    })
    const bundle = await createOrganizationPermissionBundle({
      actorUserId: account.userId,
      name: 'Organization Activity Members',
      permissions: [{ type: 'module', key: 'organization-activity.view', reviewAllowed: false }],
    })
    await createOrganizationGroup({
      actorUserId: account.userId,
      name: 'Registered Members',
      restricted: false,
      managementMode: 'compliance',
      complianceSource: 'core.registration',
      bundleIds: [bundle.bundleId],
    })
    await registerOrganizationCorporationSource({
      actorUserId: account.userId,
      corporationId: localOrganizationFixture.corporationId,
      characterId: localOrganizationFixture.directorCharacterId,
    })

    const seededResourceCount = await seedFixtureResources(now)
    await deliverSession(applicationSessionToken)
    return {
      organizationVersion,
      corporationId: localOrganizationFixture.corporationId,
      directorCharacterId: localOrganizationFixture.directorCharacterId,
      unregisteredCharacterId: localOrganizationFixture.unregisteredCharacterId,
      userId: account.userId,
      seededResourceCount,
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
  if (state?.populated)
    throw new Error('Local organization fixtures require an empty disposable database')
}

async function seedFixtureResources(validatedAt: Date) {
  const due = await selectDueInstalledResources({ limit: 100 })
  const fixtureResources = [
    coreResources.find(({ resourceId }) => resourceId === 'corporation-roster')!,
    ...installedModuleResources,
  ]
  await Promise.all(
    fixtureResources.map(async (resource) => {
      const planned = due.find(
        ({ identity }) =>
          identity.moduleId === resource.moduleId && identity.resourceId === resource.resourceId,
      )
      if (!planned) throw new Error(`Local fixture resource ${resource.resourceId} is not due`)
      const installed = findInstalledResource(planned.identity, platformResources)
      const subject = toPlatformResourceSubject(planned.identity)
      if (!installed || !subject)
        throw new Error(`Local fixture resource ${resource.resourceId} is unavailable`)
      const eligibility = await resolveInstalledResourceEligibility(planned.identity)
      if (eligibility.status !== 'eligible' || !eligibility.due)
        throw new Error(`Local fixture resource ${resource.resourceId} is ineligible`)

      try {
        await applyInstalledResourceObservation({
          identity: planned.identity,
          resource: installed,
          subject,
          authorizationGeneration: eligibility.authorizationGeneration,
          validatedAt: validatedAt.toISOString(),
          organizationVersion,
          complete: true,
          outcome: 'complete',
          data:
            resource.moduleId === 'core'
              ? [
                  localOrganizationFixture.directorCharacterId,
                  localOrganizationFixture.unregisteredCharacterId,
                ]
              : activityObservation(resource.resourceId, validatedAt),
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
    resourceId,
    expectedRevision: 0,
    organizationVersion,
    checkpoint: {
      initialized: true,
      requests: [],
      cursors: {},
      retainedIds: snapshots.map(({ snapshot }) => snapshot.id),
      retainedCampaignIds: [activityIds.campaign],
    },
    snapshots,
  }
}

function snapshotsForResource(resourceId: string, validatedAt: Date) {
  const timestamp = validatedAt.toISOString()
  const deadline = new Date(validatedAt.getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString()
  const project = {
    id: activityIds.project,
    kind: 'project' as const,
    campaignId: null,
    corporationId: localOrganizationFixture.corporationId,
    title: 'Fixture Logistics Project',
    description: 'Deliver production materials for the fixture corporation.',
    objective: 'Deliver materials',
    state: 'Active',
    progress: { current: 40, desired: 100 },
    reward: { initial: 1_000_000, remaining: 600_000 },
    deadline,
    eligibility: 'unrestricted' as const,
    contributed: null,
    committed: null,
  }
  const job = {
    ...project,
    id: activityIds.job,
    kind: 'job' as const,
    title: 'Fixture Hauling Job',
    objective: 'Haul supplies',
    progress: { current: 5, desired: 20 },
  }
  const campaign = {
    ...project,
    id: activityIds.campaign,
    kind: 'campaign' as const,
    corporationId: null,
    title: 'Fixture Military Campaign',
    description: null,
    objective: null,
    progress: { current: 0.25, desired: 1 },
    reward: null,
  }
  const objective = {
    ...campaign,
    id: activityIds.objective,
    kind: 'objective' as const,
    campaignId: activityIds.campaign,
    title: 'Fixture Campaign Objective',
    objective: 'Secure the objective',
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
      selected = [{ ...job, contributed: 5, committed: true }]
      break
    case 'character-campaigns':
      selected = [{ ...objective, contributed: 0.1, committed: true }]
      break
    case 'character-projects':
      selected = [{ ...project, contributed: 40, committed: true }]
      break
    default:
      throw new Error(`Unsupported local fixture resource ${resourceId}`)
  }
  return selected.map((snapshot) => ({ snapshot, validatedAt: timestamp, replace: true }))
}
