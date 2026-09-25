<script setup lang="ts">
import type { SystemStatusTelemetry } from '../queries/system-status'

interface ServiceStatusTelemetry {
  readonly checkedAt: SystemStatusTelemetry['checkedAt']
  readonly status: SystemStatusTelemetry['status']
  readonly services: {
    readonly api: Pick<SystemStatusTelemetry['services']['api'], 'status'>
    readonly database: Pick<SystemStatusTelemetry['services']['database'], 'latencyMs' | 'status'>
    readonly esi: Pick<SystemStatusTelemetry['services']['esi'], 'latencyMs' | 'players' | 'status'>
    readonly sde: Pick<SystemStatusTelemetry['services']['sde'], 'buildNumber' | 'status'>
  }
}

const {
  telemetry,
  apiLatencyMs,
  loading = false,
  error = false,
} = defineProps<{
  telemetry?: ServiceStatusTelemetry
  apiLatencyMs?: number
  loading?: boolean
  error?: boolean
}>()

const emit = defineEmits<{
  retry: []
}>()

const overallStatus = computed(() => telemetry?.status ?? 'pending')
const overallLabel = computed(
  () =>
    ({
      degraded: 'DEGRADED',
      operational: 'OPERATIONAL',
      pending: 'PENDING',
      unavailable: 'UNAVAILABLE',
    })[overallStatus.value],
)
const services = computed(() => {
  if (!telemetry) {
    return []
  }
  return [
    { id: 'api', label: 'API', latencyMs: apiLatencyMs, status: telemetry.services.api.status },
    {
      id: 'database',
      label: 'Database',
      latencyMs: telemetry.services.database.latencyMs,
      status: telemetry.services.database.status,
    },
    {
      id: 'tranquility',
      label: 'Tranquility',
      latencyMs: telemetry.services.esi.latencyMs,
      status: telemetry.services.esi.status,
    },
  ]
})
const sdeBuild = computed(() => {
  const sde = telemetry?.services.sde
  return sde?.status === 'operational' && sde.buildNumber !== null ? String(sde.buildNumber) : '--'
})
const checkedLabel = computed(() => {
  if (loading) {
    return 'REFRESHING'
  }
  return telemetry ? formatCheckedAt(telemetry.checkedAt) : '--'
})

function readingLabel(service: { status: string; latencyMs?: number }) {
  const latency = `${service.latencyMs ?? '--'} ms`
  return service.status === 'operational' ? latency : `${stateLabel(service.status)} / ${latency}`
}
</script>

<template>
  <section class="service-status" aria-live="polite">
    <header class="service-status-header">
      <strong class="service-status-title">System status</strong>
      <span class="service-status-badge" :data-status="overallStatus">
        <i aria-hidden="true" />
        {{ overallLabel }}
      </span>
    </header>

    <div v-if="error" class="service-status-notice">
      {{ telemetry ? 'LATEST CHECK FAILED' : 'STATUS UNAVAILABLE' }}
      <button type="button" @click="emit('retry')">RETRY</button>
    </div>

    <div v-if="!telemetry" class="service-status-empty">
      <span :class="{ 'service-status-pulse': loading }" aria-hidden="true" />
      {{ loading ? 'CHECKING STATUS' : 'NO STATUS AVAILABLE' }}
    </div>

    <template v-else>
      <ul class="service-status-services">
        <li v-for="service in services" :key="service.id" :data-status="service.status">
          <i aria-hidden="true" />
          <strong>{{ service.label }}</strong>
          <span>{{ readingLabel(service) }}</span>
        </li>
      </ul>

      <dl class="service-status-readout">
        <div>
          <dt>Pilots</dt>
          <dd>{{ formatNumber(telemetry.services.esi.players) }}</dd>
        </div>
        <div>
          <dt>Checked</dt>
          <dd :class="{ 'service-status-refreshing': loading }">{{ checkedLabel }}</dd>
        </div>
        <div>
          <dt>SDE</dt>
          <dd :data-status="telemetry.services.sde.status">{{ sdeBuild }}</dd>
        </div>
      </dl>
    </template>
  </section>
</template>

<style scoped>
.service-status {
  --service-status-tone: var(--ui-primary);

  font-family: var(--ui-font-sans);
}

.service-status-header {
  padding: 15px 18px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border-bottom: 1px solid var(--ui-border);
}

.service-status-title {
  min-width: 0;
  font-size: 13px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.service-status-badge {
  flex: 0 0 auto;
  padding: 5px 9px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid color-mix(in srgb, var(--service-status-tone) 34%, transparent);
  background: color-mix(in srgb, var(--service-status-tone) 8%, transparent);
  color: var(--service-status-tone);
  font: 700 10px/1 var(--ui-font-mono);
  letter-spacing: 0.16em;
}

.service-status-badge i {
  width: 6px;
  height: 6px;
  display: block;
  border-radius: 50%;
  background: currentColor;
  animation: service-status-beat 2.6s ease-in-out infinite;
}

.service-status-badge[data-status='pending'] {
  --service-status-tone: var(--ui-text-faint);
}

.service-status-badge[data-status='pending'] i {
  animation: none;
}

[data-status='degraded'],
[data-status='stale'] {
  --service-status-tone: var(--ui-warning);
}

[data-status='unavailable'] {
  --service-status-tone: var(--ui-danger);
}

.service-status-notice {
  padding: 10px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--ui-danger) 28%, transparent);
  background: color-mix(in srgb, var(--ui-danger) 7%, transparent);
  color: var(--ui-danger);
  font: 700 12px/1 var(--ui-font-mono);
  letter-spacing: 0.08em;
}

.service-status-notice button {
  padding: 5px 7px;
  border: 1px solid currentColor;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.service-status-empty {
  min-height: 150px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--ui-text-muted);
  font: 700 12px/1 var(--ui-font-mono);
  letter-spacing: 0.12em;
}

.service-status-empty > span {
  width: 6px;
  height: 6px;
  border: 1px solid currentColor;
}

.service-status-pulse {
  animation: service-status-fill 900ms ease-in-out infinite alternate;
}

.service-status-services {
  margin: 0;
  padding: 4px 18px 8px;
  list-style: none;
}

.service-status-services li {
  padding: 10px 0;
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  border-bottom: 1px solid color-mix(in srgb, var(--ui-border) 60%, transparent);
}

.service-status-services li:last-child {
  border-bottom: 0;
}

.service-status-services i {
  width: 8px;
  height: 8px;
  display: block;
  border: 1px solid var(--service-status-tone);
  background: color-mix(in srgb, var(--service-status-tone) 30%, transparent);
}

.service-status-services strong {
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  letter-spacing: 0.09em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.service-status-services span {
  color: var(--ui-text-subtle);
  font: 400 12px/1 var(--ui-font-mono);
  letter-spacing: 0.04em;
}

.service-status-services li:not([data-status='operational']) span {
  color: var(--service-status-tone);
}

.service-status-readout {
  margin: 0;
  padding: 12px 18px 14px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  border-top: 1px solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-text) 2%, transparent);
}

.service-status-readout div {
  min-width: 0;
  display: grid;
  gap: 5px;
}

.service-status-readout dt {
  color: var(--ui-text-faint);
  font: 700 9px/1 var(--ui-font-mono);
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.service-status-readout dd {
  margin: 0;
  overflow: hidden;
  font: 400 14px/1 var(--ui-font-mono);
  letter-spacing: 0.02em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.service-status-readout dd[data-status='unavailable'] {
  color: var(--ui-danger);
}

.service-status-refreshing {
  color: var(--ui-primary);
}

@keyframes service-status-beat {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.28;
  }
}

@keyframes service-status-fill {
  from {
    background: transparent;
  }
  to {
    background: var(--ui-primary);
    box-shadow: 0 0 10px var(--ui-primary);
  }
}

@media (prefers-reduced-motion: reduce) {
  .service-status-badge i,
  .service-status-pulse {
    animation: none;
  }
}
</style>
