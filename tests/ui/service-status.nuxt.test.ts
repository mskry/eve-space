import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ServiceStatus from '../../app/components/ServiceStatus.vue'

const telemetry = {
  checkedAt: '2026-08-20T12:30:00.000Z',
  services: {
    api: { checkedAt: '2026-08-20T12:30:00.000Z', status: 'operational', uptimeSeconds: 100 },
    database: { checkedAt: '2026-08-20T12:30:00.000Z', latencyMs: 3000, status: 'unavailable' },
    esi: {
      checkedAt: '2026-08-20T12:30:00.000Z',
      latencyMs: 210,
      players: 20_000,
      status: 'stale',
    },
    sde: {
      buildNumber: null,
      checkedAt: '2026-08-20T12:30:00.000Z',
      ingestVersion: null,
      ingestedAt: null,
      latencyMs: 4,
      status: 'unavailable',
    },
  },
  status: 'degraded',
} as const

describe('ServiceStatus', () => {
  it('labels non-operational services and missing SDE projection', async () => {
    const wrapper = await mountSuspended(ServiceStatus, {
      props: { apiLatencyMs: 12, telemetry },
    })

    expect(wrapper.get('.service-status-badge').attributes('data-status')).toBe('degraded')
    const rows = wrapper
      .findAll('.service-status-services li')
      .map((row) => [row.get('strong').text(), row.get('span').text()])
    expect(rows).toStrictEqual([
      ['API', '12 ms'],
      ['Database', 'UNAVAILABLE / 3000 ms'],
      ['Tranquility', 'STALE / 210 ms'],
    ])
    expect(wrapper.get('.service-status-readout').text()).toContain('SDE--')
  })

  it('emits retry from the failed-check notice', async () => {
    const wrapper = await mountSuspended(ServiceStatus, { props: { error: true } })

    expect(wrapper.text()).toContain('STATUS UNAVAILABLE')
    expect(wrapper.text()).toContain('NO STATUS AVAILABLE')
    await wrapper.get('.service-status-notice button').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })
})
