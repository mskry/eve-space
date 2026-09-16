import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ServiceStatus from '../../app/components/ServiceStatus.vue'
import type { SystemStatusTelemetry } from '../../app/queries/system-status'

const telemetry = {
  status: 'degraded',
  checkedAt: '2026-08-20T12:30:00.000Z',
  services: {
    api: { status: 'operational', uptimeSeconds: 100, checkedAt: '2026-08-20T12:30:00.000Z' },
    database: { status: 'unavailable', latencyMs: 3_000, checkedAt: '2026-08-20T12:30:00.000Z' },
    sde: {
      status: 'unavailable',
      latencyMs: 4,
      checkedAt: '2026-08-20T12:30:00.000Z',
      buildNumber: null,
      ingestVersion: null,
      ingestedAt: null,
    },
    esi: {
      status: 'stale',
      latencyMs: 210,
      checkedAt: '2026-08-20T12:30:00.000Z',
      players: 20_000,
    },
  },
} as unknown as SystemStatusTelemetry

describe('ServiceStatus', () => {
  it('labels non-operational services and missing SDE projection', async () => {
    const wrapper = await mountSuspended(ServiceStatus, {
      props: { telemetry, apiLatencyMs: 12 },
    })

    expect(wrapper.get('.service-status-badge').attributes('data-status')).toBe('degraded')
    const rows = wrapper
      .findAll('.service-status-services li')
      .map((row) => [row.get('strong').text(), row.get('span').text()])
    expect(rows).toEqual([
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
