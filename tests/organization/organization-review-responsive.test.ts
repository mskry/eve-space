import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('organization review responsive containment', () => {
  it('keeps the shell, directory, tabs, and panel bounded at mobile and desktop widths', async () => {
    const files = await Promise.all([
      readFile('app/pages/organization/review.vue', 'utf8'),
      readFile('app/components/organization-review/OrganizationReviewDirectory.vue', 'utf8'),
      readFile(
        'app/components/organization-review/OrganizationReviewContributionNavigation.vue',
        'utf8',
      ),
      readFile('app/components/organization-review/OrganizationReviewPanelHost.vue', 'utf8'),
    ])
    const css = files.join('\n')

    expect(css).toContain('min-width: 0')
    expect(css).toContain('max-width: 100%')
    expect(css).toContain('overflow-x: clip')
    expect(css).toContain('overflow-x: auto')
    expect(css).toContain('@media (max-width: 36rem)')
    expect(css).toContain('@media (max-width: 44rem)')
    expect(css).toContain('@media (max-width: 52rem)')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
