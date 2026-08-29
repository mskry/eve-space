import { describe, expect, test, vi } from 'vitest'
import { loadPlannerScheduleOffset } from '../../src/deployment/installation-settings.js'

describe('deployment installation settings', () => {
  test('uses an explicit environment override without reading PostgreSQL', async () => {
    const connection = vi.fn()

    await expect(loadPlannerScheduleOffset(12_345, connection as never)).resolves.toBe(12_345)
    expect(connection).not.toHaveBeenCalled()
  })

  test('loads the generated installation offset from PostgreSQL', async () => {
    const connection = vi.fn().mockResolvedValue([{ planner_schedule_offset_ms: 54_321 }])

    await expect(loadPlannerScheduleOffset(undefined, connection as never)).resolves.toBe(54_321)
  })

  test('refuses to schedule without installation settings', async () => {
    const connection = vi.fn().mockResolvedValue([])

    await expect(loadPlannerScheduleOffset(undefined, connection as never)).rejects.toThrow(
      'Deployment installation settings are missing',
    )
  })
})
