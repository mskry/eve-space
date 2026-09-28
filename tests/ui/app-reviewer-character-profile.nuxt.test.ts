import { mountSuspended } from '@nuxt/test-utils/runtime'
import { expect, test } from 'vitest'
import AppReviewerCharacterProfile from '../../app/components/AppReviewerCharacterProfile.vue'

const profile = {
  id: 90_000_002,
  name: 'Reviewed Alt',
  birthday: '2008-01-31T00:00:00Z',
  gender: 'female',
  race: 'Amarr',
  raceFactionId: 500_003,
  bloodline: 'Khanid',
  securityStatus: -0.3,
  achievementScore: 12,
  corporationTitle: 'Pilot',
  bio: { plainText: 'Sanitized biography', runs: [{ start: 0, text: 'Sanitized biography' }] },
  factionId: null,
  corporation: { id: 1_000_166, name: 'Academy', ticker: 'ACA', memberCount: 42 },
  alliance: null,
  validatedAt: '2026-09-18T12:00:00Z',
  cachedUntil: '2026-09-19T12:00:00Z',
  stale: false,
}

test('renders public biography and identity without owner action controls', async () => {
  const wrapper = await mountSuspended(AppReviewerCharacterProfile, {
    props: { profile, state: 'ready' },
  })
  expect(wrapper.text()).toContain('Reviewed Alt')
  expect(wrapper.text()).toContain('Sanitized biography')
  expect(wrapper.text()).toContain('Academy')
  expect(wrapper.text()).toContain('Read-only character review')
  expect(wrapper.text()).not.toMatch(/send mail|detach|set main|reauthorize|transfer/i)
  expect(wrapper.findAll('button')).toHaveLength(0)
  wrapper.unmount()
})
