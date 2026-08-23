import type postgres from 'postgres'
import { sql } from './db/client.js'
import { env } from './env.js'

export async function loadPlannerScheduleOffset(
  override = env.QUEUE_PLANNER_SCHEDULE_OFFSET_MS,
  connection: postgres.Sql = sql,
) {
  if (override !== undefined) return override

  const [settings] = await connection<{ planner_schedule_offset_ms: number }[]>`
    select planner_schedule_offset_ms
    from deployment_installation_settings
    where id = 1
  `
  if (!settings) throw new Error('Deployment installation settings are missing')
  return settings.planner_schedule_offset_ms
}
