import { describe, expect, it } from 'vitest'
import { visibleDashboardSections } from '../app/utils/dashboard-sections'

describe('dashboard section visibility', () => {
  it('hides administration without a local owner session', () => {
    expect(visibleDashboardSections(false).some((section) => section.to === '/admin')).toBe(false)
  })

  it('shows administration to the authenticated deployment owner', () => {
    expect(visibleDashboardSections(true).some((section) => section.to === '/admin')).toBe(true)
  })
})
