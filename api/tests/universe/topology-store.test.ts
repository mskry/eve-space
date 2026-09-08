import { describe, expect, test, vi } from 'vitest'
import { loadUniverseTopologySnapshot } from '../../src/universe/topology-store.js'

describe('universe topology projection', () => {
  test('projects systems, finite security metadata, and directed stargate neighbors', async () => {
    const snapshot = await loadUniverseTopologySnapshot(
      database([
        system(1, '0.9'),
        system(2, null),
        system(3, '-0.4'),
        stargate(10, 1, 2),
        stargate(11, 1, 3),
        stargate(12, 2, 1),
      ]) as never,
    )

    expect(snapshot.buildNumber).toBe(1234)
    expect([...snapshot.systems.values()]).toEqual([
      { id: 1, securityStatus: 0.9, neighbors: [2, 3] },
      { id: 2, securityStatus: null, neighbors: [1] },
      { id: 3, securityStatus: -0.4, neighbors: [] },
    ])
  })

  test.each([
    ['an empty graph', []],
    ['an invalid system ID', [system(0, '0.9'), stargate(10, 1, 2)]],
    ['an invalid row key', [{ ...system(1, '0.9'), key: '2' }, system(2), stargate(10, 1, 2)]],
    ['non-finite security', [system(1, 'NaN'), system(2), stargate(10, 1, 2)]],
    ['an unknown source system', [system(1), system(2), stargate(10, 3, 2)]],
    ['an unknown destination system', [system(1), system(2), stargate(10, 1, 3)]],
    ['a missing destination', [system(1), system(2), stargate(10, 1, null)]],
  ])('rejects malformed topology containing %s', async (_description, rows) => {
    await expect(loadUniverseTopologySnapshot(database(rows) as never)).rejects.toThrow(
      'Universe topology',
    )
  })
})

function database(rows: readonly Record<string, unknown>[]) {
  const transaction = Object.assign(
    vi.fn((strings: TemplateStringsArray) => {
      const statement = strings.join(' ')
      let result: unknown[] = []
      if (statement.includes('from sde_builds')) result = [{ build_number: '1234' }]
      else if (statement.includes('from sde_dataset_rows')) result = [...rows]
      return cancellable(result)
    }),
    { unsafe: vi.fn(() => cancellable([])) },
  )
  return {
    begin: vi.fn((_options: string, load: (value: typeof transaction) => Promise<unknown>) =>
      load(transaction),
    ),
  }
}

function cancellable<Value>(value: Value) {
  return Object.assign(Promise.resolve(value), { cancel: vi.fn() })
}

function system(id: number, securityStatus: string | null = '0.1') {
  return {
    dataset: 'mapSolarSystems',
    key: String(id),
    id: String(id),
    security_status: securityStatus,
    source_system_id: null,
    destination_system_id: null,
  }
}

function stargate(id: number, sourceSystemId: number, destinationSystemId: number | null) {
  return {
    dataset: 'mapStargates',
    key: String(id),
    id: String(id),
    security_status: null,
    source_system_id: String(sourceSystemId),
    destination_system_id: destinationSystemId === null ? null : String(destinationSystemId),
  }
}
