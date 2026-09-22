// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectDomainEventEvidence } from '../../scripts/domain-event-review/evidence'
import { classifyDomainEvent } from '../../scripts/domain-event-review/findings'
import type { DomainEventJudgment } from '../../scripts/domain-event-review/judgments'

const judgment = (overrides: Partial<DomainEventJudgment> = {}): DomainEventJudgment => ({
  mutationFit: { choice: 'aligned', confidence: 0.95 },
  schemaFit: { choice: 'aligned', confidence: 0.95 },
  identityFit: { choice: 'complete', confidence: 0.95 },
  deliverySafety: { choice: 'safe', confidence: 0.95 },
  sensitivityFit: { choice: 'minimal', confidence: 0.95 },
  ...overrides,
})

describe('domain-event semantic evidence', () => {
  it('binds a changed producer to its schema and convergent consumer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eve-space-domain-event-'))
    try {
      await mkdir(join(root, 'api/src/domain-events'), { recursive: true })
      await mkdir(join(root, 'api/src/orders'), { recursive: true })
      await mkdir(join(root, 'api/src/projections'), { recursive: true })
      await writeFile(
        join(root, 'api/src/domain-events/definitions.ts'),
        `
const orderChangedSchema = z.object({ orderId: z.string(), revision: z.number() }).strict()
const domainEventRegistry = {
  'order.changed': { aggregateType: 'order', versions: { 1: orderChangedSchema } },
} as const
`,
      )
      await writeFile(
        join(root, 'api/src/domain-events/handlers.ts'),
        `
import { rebuildOrder } from '../projections/orders.js'
const orderEventTypes = ['order.changed'] as const
export function createOrderHandlers(rebuild = rebuildOrder) {
  return orderEventTypes.map((eventType) => ({
    eventType,
    payloadVersion: 1,
    idempotency: 'convergent-state',
    handle: (event) => rebuild(event.payload.orderId),
  }))
}
`,
      )
      await writeFile(
        join(root, 'api/src/orders/store.ts'),
        `
import { appendDomainEvent as append } from '../domain-events/store.js'
export async function updateOrder(transaction, orderId, revision) {
  await transaction.update(orders).set({ revision }).where(eq(orders.id, orderId))
  await append(transaction, {
    type: 'order.changed',
    payloadVersion: 1,
    aggregateId: orderId,
    payload: { orderId, revision },
  })
}
`,
      )
      await writeFile(
        join(root, 'api/src/projections/orders.ts'),
        `export async function rebuildOrder(orderId) { return orderId }\n`,
      )

      const evidence = await collectDomainEventEvidence(root, ['api/src/orders/store.ts'])

      expect(evidence).toHaveLength(1)
      expect(evidence[0]).toMatchObject({
        producer: {
          eventType: 'order.changed',
          functionName: 'updateOrder',
          aggregateId: 'orderId',
        },
        definition: { aggregateType: 'order', payloadVersion: 1 },
      })
      expect(evidence[0].producer.mutationContext).toContain('transaction.update')
      expect(evidence[0].definition?.payloadSchema).toContain('orderChangedSchema')
      expect(evidence[0].consumers).toHaveLength(1)
      expect(evidence[0].consumers[0]).toMatchObject({
        functionName: 'createOrderHandlers',
        idempotency: 'convergent-state',
        dependencyFiles: ['api/src/projections/orders.ts'],
      })
      expect(evidence[0].consumers[0].dependencies[0]?.code).toContain('rebuildOrder')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('expands a dynamic event type against registered definitions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eve-space-domain-event-template-'))
    try {
      await mkdir(join(root, 'api/src/domain-events'), { recursive: true })
      await mkdir(join(root, 'api/src/organizations'), { recursive: true })
      await writeFile(
        join(root, 'api/src/domain-events/definitions.ts'),
        `
const schema = z.object({ organizationId: z.number() })
const domainEventRegistry = {
  'organization.added': { aggregateType: 'organization', versions: { 1: schema } },
  'organization.removed': { aggregateType: 'organization', versions: { 1: schema } },
} as const
`,
      )
      await writeFile(join(root, 'api/src/domain-events/handlers.ts'), '')
      await writeFile(
        join(root, 'api/src/organizations/store.ts'),
        `
import { appendDomainEvent } from '../domain-events/store.js'
export function appendTransition(transaction, transition, organizationId) {
  return appendDomainEvent(transaction, {
    type: \`organization.\${transition}\`, payloadVersion: 1, aggregateId: String(organizationId), payload: { organizationId }
  })
}
`,
      )

      const evidence = await collectDomainEventEvidence(root, ['api/src/organizations/store.ts'])
      expect(evidence.map(({ producer }) => producer.eventType)).toEqual([
        'organization.added',
        'organization.removed',
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('domain-event semantic finding classification', () => {
  const evidence = {
    id: 'api/src/orders/store.ts:8:order.changed',
    producer: {
      id: 'api/src/orders/store.ts:8:order.changed',
      file: 'api/src/orders/store.ts',
      line: 8,
      functionName: 'updateOrder',
      eventType: 'order.changed',
      eventTypeExpression: "'order.changed'",
      payloadVersion: 1,
      aggregateId: 'orderId',
      payload: '{ orderId, revision }',
      appendCall: 'appendDomainEvent(...)',
      mutationContext: 'update order and append event',
    },
    definition: {
      eventType: 'order.changed',
      payloadVersion: 1,
      aggregateType: 'order',
      registryEntry: "'order.changed': {...}",
      payloadSchema: 'orderChangedSchema',
    },
    consumers: [],
  } as const

  it('passes a confidently aligned event', () => {
    expect(classifyDomainEvent(evidence, judgment()).verdict).toBe('pass')
  })

  it.each([
    ['mutationFit', { choice: 'misleading', confidence: 0.95 }],
    ['schemaFit', { choice: 'mismatch', confidence: 0.95 }],
    ['identityFit', { choice: 'incomplete', confidence: 0.95 }],
    ['deliverySafety', { choice: 'unsafe', confidence: 0.95 }],
    ['sensitivityFit', { choice: 'secret_like', confidence: 0.95 }],
  ] as const)('reports a high-confidence %s defect', (signal, value) => {
    expect(classifyDomainEvent(evidence, judgment({ [signal]: value })).verdict).toBe('report')
  })

  it('keeps excessive but non-sensitive payload data advisory', () => {
    const finding = classifyDomainEvent(
      evidence,
      judgment({ sensitivityFit: { choice: 'excessive', confidence: 0.95 } }),
    )
    expect(finding.verdict).toBe('review')
  })

  it('routes low-confidence aligned judgments to review', () => {
    const finding = classifyDomainEvent(
      evidence,
      judgment({ deliverySafety: { choice: 'safe', confidence: 0.3 } }),
    )
    expect(finding.verdict).toBe('review')
  })
})
