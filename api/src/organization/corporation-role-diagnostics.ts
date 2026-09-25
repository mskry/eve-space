import { sql } from 'drizzle-orm'
import {
  loadCorporationRoleEvidenceDiagnostics,
  type CorporationRoleEvidenceDiagnostics,
} from '../characters/corporation-role-evidence.js'
import { db } from '../db/client.js'

type CorporationRoleEvidenceCounts = CorporationRoleEvidenceDiagnostics & {
  readonly legacy: number
}

export type CorporationRoleEvidenceStatus =
  | ({ readonly status: 'operational' | 'degraded' } & CorporationRoleEvidenceCounts)
  | ({ readonly status: 'unavailable' } & {
      readonly [Count in keyof CorporationRoleEvidenceCounts]: null
    })

const countLegacyRoleContinuity = async (now: Date) => {
  const nowValue = now.toISOString()
  const [row] = await db.execute<{ legacy: number }>(sql`
    select (
      (select count(*) from organization_authority_evidence
        where legacy_role_continuity_until > ${nowValue}::timestamptz)
      + (select count(*) from organization_derived_authority_sources
        where legacy_role_continuity_until > ${nowValue}::timestamptz)
      + (select count(*) from organization_corporation_sources
        where legacy_role_continuity_until > ${nowValue}::timestamptz)
    )::integer as legacy
  `)
  return row?.legacy ?? 0
}

export const probeCorporationRoleEvidenceStatus = async (
  now = new Date(),
): Promise<CorporationRoleEvidenceStatus> => {
  try {
    const [evidence, legacy] = await Promise.all([
      loadCorporationRoleEvidenceDiagnostics(db, now),
      countLegacyRoleContinuity(now),
    ])
    return {
      ...evidence,
      legacy,
      status: evidence.overdue > 0 ? 'degraded' : 'operational',
    }
  } catch {
    return {
      degraded: null,
      fresh: null,
      invalid: null,
      legacy: null,
      overdue: null,
      pending: null,
      status: 'unavailable',
    }
  }
}
