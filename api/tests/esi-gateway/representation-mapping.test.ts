import { describe, expect, test, vi } from 'vitest'
import type { CapturedEsiCallable } from './registered-caller-test-adapters.js'
import { createRuntimeTestExecution, createRuntimeTestPorts } from './runtime-test-adapters.js'

const gatewayMocks = vi.hoisted(() => ({
  callables: new Map<string, CapturedEsiCallable>(),
  getProductionRuntime: vi.fn(),
}))

vi.mock('../../src/esi-gateway/internal/production-runtime.js', () => ({
  getProductionEsiExecutionRuntime: gatewayMocks.getProductionRuntime,
}))

vi.mock('../../src/esi-gateway/feature-execution.js', async (importOriginal) => {
  const { captureRegisteredEsiCallables } = await import('./registered-caller-test-adapters.js')
  return captureRegisteredEsiCallables(
    await importOriginal<typeof import('../../src/esi-gateway/feature-execution.js')>(),
    gatewayMocks.callables,
  )
})

const query = Promise.resolve<never[]>([])
Object.assign(query, {
  from: vi.fn(() => query),
  innerJoin: vi.fn(() => query),
  leftJoin: vi.fn(() => query),
  limit: vi.fn(() => query),
  where: vi.fn(() => query),
})

vi.mock('../../src/db/client.js', () => ({
  db: { select: vi.fn(() => query) },
}))

await import('../../src/universe/names.js')
vi.doMock('../../src/universe/names.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/universe/names.js')>()),
  resolveUniverseNames: async (ids: readonly number[]) =>
    new Map(
      ids.map((id) => [
        id,
        {
          category:
            id === 8 ? 'character' : id === 9 ? 'corporation' : id === 10 ? 'alliance' : 'station',
          id,
          name: `Resolved ${id}`,
        },
      ]),
    ),
}))
await Promise.all([
  import('../../src/corporations/public-data.js'),
  import('../../src/alliances/public-data.js'),
  import('../../src/characters/affiliation-sync.js'),
  import('../../src/characters/assets.js'),
  import('../../src/characters/attributes.js'),
  import('../../src/characters/clones.js'),
  import('../../src/characters/contracts.js'),
  import('../../src/characters/market.js'),
  import('../../src/characters/profile.js'),
  import('../../src/characters/overview.js'),
  import('../../src/characters/corporation-roles.js'),
  import('../../src/characters/skill-queue.js'),
  import('../../src/characters/skills.js'),
  import('../../src/characters/wallet.js'),
  import('../../src/characters/history.js'),
  import('../../src/mail/mailbox.js'),
  import('../../src/system/status.js'),
  import('../../src/universe/locations.js'),
])

const characterId = 7
const subjectLifecycleId = '11111111-1111-4111-8111-111111111111'
const affiliationPeriodRevision = '22222222-2222-4222-8222-222222222222'

interface MappingCase {
  readonly name: string
  readonly input: unknown
  readonly response: unknown
  readonly expected: unknown
  readonly headers?: HeadersInit
  readonly status?: number
}

const cases: readonly MappingCase[] = [
  {
    expected: [{ category: 'character', id: 7, name: 'Pilot' }],
    input: { body: [7] },
    name: 'universe-names-core',
    response: [{ category: 'character', id: 7, name: 'Pilot' }],
  },
  {
    expected: [{ category: 'character', id: 7, name: 'Pilot' }],
    input: { body: ['Pilot'] },
    name: 'universe-ids-core',
    response: { characters: [{ id: 7, name: 'Pilot' }] },
  },
  {
    expected: [
      { category: 'alliance', id: 10, name: 'Alliance' },
      { category: 'solar_system', id: 30_000_142, name: 'Jita' },
    ],
    input: { body: ['Alliance', 'Jita'] },
    name: 'universe-ids-core',
    response: {
      alliances: [{ id: 10, name: 'Alliance' }],
      corporations: [{ id: 9 }, { name: 'Corporation' }],
      systems: [{ id: 30_000_142, name: 'Jita' }],
    },
  },
  {
    expected: {
      corporation: {
        allianceId: 10,
        allianceName: 'Resolved 10',
        ceoId: 8,
        ceoName: 'Resolved 8',
        creatorId: 9,
        creatorName: 'Resolved 9',
        dateFounded: '2026-01-01T00:00:00Z',
        description: 'Corporation',
        factionId: 500_001,
        friendlyFire: 'legal',
        homeStationId: 11,
        homeStationName: 'Resolved 11',
        loyaltyPointTaxRate: 0,
        memberCount: 12,
        name: 'Corporation',
        shares: 1000,
        state: 'active',
        taxRate: 0.05,
        ticker: 'CORP',
        type: 'player_owned',
        url: 'https://example.com',
        warEligible: true,
      },
      found: true,
    },
    input: { corporationId: 7 },
    name: 'public-corporation-core',
    response: {
      alliance_id: 10,
      ceo_id: 8,
      creator_id: 9,
      date_founded: '2026-01-01T00:00:00Z',
      description: '<b>Corporation</b>',
      enlisted_faction_id: 500_001,
      friendly_fire: 'legal',
      home_station_id: 11,
      member_count: 12,
      name: 'Corporation',
      shares: 1000,
      state: 'active',
      tax_rates: { isk: 0.05, loyalty_point: 0 },
      ticker: 'CORP',
      type: 'player_owned',
      url: 'https://example.com',
      war_eligible: true,
    },
  },
  {
    expected: {
      corporation: {
        allianceId: null,
        allianceName: null,
        ceoId: null,
        ceoName: null,
        creatorId: null,
        creatorName: null,
        dateFounded: null,
        description: null,
        factionId: null,
        friendlyFire: 'illegal',
        homeStationId: 11,
        homeStationName: 'Resolved 11',
        loyaltyPointTaxRate: 0,
        memberCount: 1,
        name: 'Minimal corporation',
        shares: 0,
        state: 'closed',
        taxRate: 0,
        ticker: 'MIN',
        type: 'npc_owned',
        url: null,
        warEligible: false,
      },
      found: true,
    },
    input: { corporationId: 7 },
    name: 'public-corporation-core',
    response: {
      description: '',
      friendly_fire: 'illegal',
      home_station_id: 11,
      member_count: 1,
      name: 'Minimal corporation',
      shares: 0,
      state: 'closed',
      tax_rates: { isk: 0, loyalty_point: 0 },
      ticker: 'MIN',
      type: 'npc_owned',
      war_eligible: false,
    },
  },
  {
    expected: { found: false },
    input: { corporationId: 404 },
    name: 'public-corporation-core',
    response: { error: 'Corporation not found' },
    status: 404,
  },
  {
    expected: [
      {
        allianceId: null,
        allianceName: null,
        isDeleted: false,
        recordId: 2,
        startDate: '2026-01-01T00:00:00Z',
      },
    ],
    input: { corporationId: 7 },
    name: 'corporation-alliance-history-core',
    response: [{ record_id: 2, start_date: '2026-01-01T00:00:00Z' }],
  },
  {
    expected: [
      {
        allianceId: 10,
        allianceName: 'Resolved 10',
        isDeleted: true,
        recordId: 3,
        startDate: '2026-02-01T00:00:00Z',
      },
    ],
    input: { corporationId: 7 },
    name: 'corporation-alliance-history-core',
    response: [
      {
        alliance_id: 10,
        is_deleted: true,
        record_id: 3,
        start_date: '2026-02-01T00:00:00Z',
      },
    ],
  },
  {
    expected: [1_000_001],
    input: {},
    name: 'corporation-npc-list-core',
    response: [1_000_001],
  },
  {
    expected: {
      assets: [
        {
          isBlueprintCopy: true,
          isSingleton: true,
          itemId: 10,
          locationFlag: 'Hangar',
          locationId: 9,
          locationType: 'item',
          parentItemId: 9,
          quantity: 2,
          typeId: 34,
        },
      ],
      page: 1,
      totalPages: 1,
    },
    headers: { 'X-Pages': '1' },
    input: { characterId, page: 1, subjectLifecycleId },
    name: 'character-assets-page-core',
    response: [
      {
        is_blueprint_copy: true,
        is_singleton: true,
        item_id: 10,
        location_flag: 'Hangar',
        location_id: 9,
        location_type: 'item',
        quantity: 2,
        type_id: 34,
      },
    ],
  },
  {
    expected: {
      assets: [
        {
          isBlueprintCopy: null,
          isSingleton: false,
          itemId: 11,
          locationFlag: 'Cargo',
          locationId: 60_000_001,
          locationType: 'station',
          parentItemId: null,
          quantity: 4,
          typeId: 35,
        },
      ],
      page: 1,
      totalPages: 1,
    },
    headers: { 'X-Pages': '1' },
    input: { characterId, page: 1, subjectLifecycleId },
    name: 'character-assets-page-core',
    response: [
      {
        is_singleton: false,
        item_id: 11,
        location_flag: 'Cargo',
        location_id: 60_000_001,
        location_type: 'station',
        quantity: 4,
        type_id: 35,
      },
    ],
  },
  {
    expected: {
      accruedRemapCooldownDate: '2026-02-01T00:00:00Z',
      bonusRemaps: 2,
      charisma: 19,
      intelligence: 20,
      lastRemapDate: '2026-01-01T00:00:00Z',
      memory: 21,
      perception: 22,
      willpower: 23,
    },
    input: { characterId, subjectLifecycleId },
    name: 'character-attributes-core',
    response: {
      accrued_remap_cooldown_date: '2026-02-01T00:00:00Z',
      bonus_remaps: 2,
      charisma: 19,
      intelligence: 20,
      last_remap_date: '2026-01-01T00:00:00Z',
      memory: 21,
      perception: 22,
      willpower: 23,
    },
  },
  {
    expected: {
      homeLocation: { locationId: 60_000_001, locationType: 'station' },
      jumpClones: [
        {
          implantTypeIds: [1, 2],
          jumpCloneId: 10,
          location: { locationId: 60_000_002, locationType: 'station' },
          name: 'Travel clone',
        },
      ],
      lastCloneJumpAt: '2026-01-01T00:00:00Z',
      lastStationChangeAt: '2026-01-02T00:00:00Z',
    },
    input: { characterId, subjectLifecycleId },
    name: 'character-clones-core',
    response: {
      home_location: { location_id: 60_000_001, location_type: 'station' },
      jump_clones: [
        {
          implants: [1, 1, 2],
          jump_clone_id: 10,
          location_id: 60_000_002,
          location_type: 'station',
          name: 'Travel clone',
        },
      ],
      last_clone_jump_date: '2026-01-01T00:00:00Z',
      last_station_change_date: '2026-01-02T00:00:00Z',
    },
  },
  {
    expected: { implantTypeIds: [1, 2] },
    input: { characterId, subjectLifecycleId },
    name: 'character-implants-core',
    response: [1, 1, 2],
  },
  {
    expected: {
      skills: [{ activeLevel: 3, skillpoints: 100, trainedLevel: 4, typeId: 34 }],
      totalSp: 1000,
      unallocatedSp: 50,
    },
    input: { characterId, subjectLifecycleId },
    name: 'character-skills-core',
    response: {
      skills: [
        { active_skill_level: 3, skill_id: 34, skillpoints_in_skill: 100, trained_skill_level: 4 },
      ],
      total_sp: 1000,
      unallocated_sp: 50,
    },
  },
  {
    expected: {
      entries: [
        {
          finishDate: '2026-02-01T00:00:00Z',
          finishedLevel: 4,
          groupId: null,
          groupName: 'Unknown',
          levelEndSp: 100,
          levelStartSp: 0,
          name: 'Unknown skill 34',
          primaryAttribute: null,
          queuePosition: 1,
          secondaryAttribute: null,
          startDate: '2026-01-01T00:00:00Z',
          trainingStartSp: 25,
          typeId: 34,
        },
      ],
    },
    input: { characterId, subjectLifecycleId },
    name: 'character-skill-queue-core',
    response: [
      {
        finish_date: '2026-02-01T00:00:00Z',
        finished_level: 4,
        level_end_sp: 100,
        level_start_sp: 0,
        queue_position: 1,
        skill_id: 34,
        start_date: '2026-01-01T00:00:00Z',
        training_start_sp: 25,
      },
    ],
  },
  {
    expected: [{ itemId: 10, name: 'Named asset' }],
    input: { body: [10], path: { character_id: characterId }, subjectLifecycleId },
    name: 'character-asset-names-core',
    response: [{ item_id: 10, name: 'Named asset' }],
  },
  {
    expected: {
      contracts: [
        {
          acceptedAt: null,
          availability: 'personal',
          buyout: null,
          collateral: null,
          completedAt: null,
          contractId: 20,
          daysToComplete: null,
          endLocationId: null,
          expiredAt: '2026-02-01T00:00:00Z',
          issuedAt: '2026-01-01T00:00:00Z',
          price: null,
          reward: null,
          role: 'assigned',
          startLocationId: null,
          status: 'outstanding',
          title: null,
          type: 'courier',
          volume: null,
        },
      ],
      page: 2,
      totalPages: 2,
    },
    input: { characterId, page: 2, subjectLifecycleId },
    name: 'character-contracts-core',
    response: [
      {
        acceptor_id: 8,
        assignee_id: characterId,
        availability: 'personal',
        contract_id: 20,
        date_expired: '2026-02-01T00:00:00Z',
        date_issued: '2026-01-01T00:00:00Z',
        for_corporation: false,
        issuer_corporation_id: 9,
        issuer_id: 10,
        status: 'outstanding',
        type: 'courier',
      },
    ],
  },
  {
    expected: {
      items: [
        {
          blueprint: 'copy',
          direction: 'included',
          isSingleton: false,
          quantity: 3,
          recordId: 1,
          typeId: 34,
          typeName: 'Unknown type 34',
        },
      ],
    },
    input: { characterId, contractId: 20, subjectLifecycleId },
    name: 'character-contract-items-core',
    response: [
      {
        is_included: true,
        is_singleton: false,
        quantity: 3,
        raw_quantity: -2,
        record_id: 1,
        type_id: 34,
      },
    ],
  },
  {
    expected: { bids: [{ amount: 10, bidAt: '2026-01-02T00:00:00Z', bidId: 2 }] },
    input: { characterId, contractId: 20, subjectLifecycleId },
    name: 'character-contract-bids-core',
    response: [{ amount: 10, bid_id: 2, bidder_id: 8, date_bid: '2026-01-02T00:00:00Z' }],
  },
  {
    expected: {
      orders: [
        {
          durationDays: 3,
          escrow: null,
          expiresAt: '2026-01-04T00:00:00.000Z',
          isBuy: false,
          issuedAt: '2026-01-01T00:00:00Z',
          locationId: 1_000_000_000_000,
          locationName: null,
          minimumVolume: null,
          orderId: 30,
          price: 7.5,
          range: 'station',
          regionId: 10_000_002,
          typeId: 34,
          typeName: 'Unknown type 34',
          volumeRemain: 2,
          volumeTotal: 4,
        },
      ],
    },
    input: { characterId, subjectLifecycleId },
    name: 'market-orders-core',
    response: [marketOrder()],
  },
  {
    expected: {
      orders: [{ ...mappedMarketOrder(), escrow: 12, isBuy: true, minimumVolume: 2 }],
    },
    input: { characterId, subjectLifecycleId },
    name: 'market-orders-core',
    response: [
      { ...marketOrder(), escrow: 12, is_buy_order: true, min_volume: 2 },
      { ...marketOrder(), is_corporation: true, order_id: 31 },
    ],
  },
  {
    expected: {
      orders: [{ ...mappedMarketOrder(), state: 'cancelled' }],
      page: 3,
      totalPages: 3,
    },
    input: { characterId, page: 3, subjectLifecycleId },
    name: 'market-order-history-core',
    response: [{ ...marketOrder(), state: 'cancelled' }],
  },
  {
    expected: {
      achievementScore: 0,
      allianceId: null,
      birthday: '2026-01-01T00:00:00Z',
      bloodlineId: 5,
      corporationId: 9,
      factionId: null,
      gender: 'female',
      name: 'Pilot',
      raceId: 4,
      securityStatus: 0,
    },
    input: { characterId },
    name: 'public-character-core',
    response: {
      achievement_score: 0,
      birthday: '2026-01-01T00:00:00Z',
      bloodline_id: 5,
      corporation_id: 9,
      gender: 'female',
      name: 'Pilot',
      race_id: 4,
    },
  },
  {
    expected: {
      achievementScore: 1,
      allianceId: 10,
      birthday: '2026-01-01T00:00:00Z',
      bloodlineId: 5,
      corporationId: 9,
      corporationTitle: 'Director',
      description: '<i>Biography</i>',
      factionId: 500_001,
      gender: 'male',
      name: 'Pilot',
      raceId: 4,
      securityStatus: 1.5,
    },
    input: { characterId },
    name: 'public-character-core',
    response: {
      achievement_score: 1,
      alliance_id: 10,
      birthday: '2026-01-01T00:00:00Z',
      bloodline_id: 5,
      corporation_id: 9,
      corporation_title: 'Director',
      description: '<i>Biography</i>',
      faction_id: 500_001,
      gender: 'male',
      name: 'Pilot',
      race_id: 4,
      security_status: 1.5,
    },
  },
  {
    expected: [{ name: 'Caldari', raceId: 1 }],
    input: {},
    name: 'universe-races-core',
    response: [{ alliance_id: 10, description: 'Caldari', name: 'Caldari', race_id: 1 }],
  },
  {
    expected: [{ bloodlineId: 1, name: 'Deteis' }],
    input: {},
    name: 'universe-bloodlines-core',
    response: [{ bloodline_id: 1, name: 'Deteis', race_id: 1 }],
  },
  {
    expected: {
      constellation_id: 20_000_020,
      name: 'Jita',
      position: { x: 1, y: 2, z: 3 },
      security_status: 0.9,
      system_id: 30_000_142,
    },
    input: { systemId: 30_000_142 },
    name: 'universe-solar-system-core',
    response: {
      constellation_id: 20_000_020,
      name: 'Jita',
      position: { x: 1, y: 2, z: 3 },
      security_status: 0.9,
      system_id: 30_000_142,
    },
  },
  {
    expected: {
      max_dockable_ship_volume: 1,
      name: 'Jita IV - Moon 4',
      office_rental_cost: 1,
      position: { x: 1, y: 2, z: 3 },
      reprocessing_efficiency: 0.5,
      reprocessing_stations_take: 0.05,
      services: ['docking'],
      station_id: 60_000_001,
      system_id: 30_000_142,
      type_id: 1526,
    },
    input: { stationId: 60_000_001 },
    name: 'universe-station-core',
    response: {
      max_dockable_ship_volume: 1,
      name: 'Jita IV - Moon 4',
      office_rental_cost: 1,
      position: { x: 1, y: 2, z: 3 },
      reprocessing_efficiency: 0.5,
      reprocessing_stations_take: 0.05,
      services: ['docking'],
      station_id: 60_000_001,
      system_id: 30_000_142,
      type_id: 1526,
    },
  },
  {
    expected: { solarSystemId: 30_000_142, stationId: 60_000_001, structureId: 9 },
    input: { characterId, subjectLifecycleId },
    name: 'character-location-core',
    response: { solar_system_id: 30_000_142, station_id: 60_000_001, structure_id: 9 },
  },
  {
    expected: { name: 'Pod', typeId: 670 },
    input: { characterId, subjectLifecycleId },
    name: 'character-ship-core',
    response: { ship_item_id: 1, ship_name: 'Pod', ship_type_id: 670 },
  },
  {
    expected: { groupId: 29, name: 'Capsule' },
    input: { typeId: 670 },
    name: 'universe-type-core',
    response: { description: '', group_id: 29, name: 'Capsule', published: true, type_id: 670 },
  },
  {
    expected: 123.45,
    input: { characterId, subjectLifecycleId },
    name: 'wallet-balance-core',
    response: 123.45,
  },
  {
    expected: {
      entries: [
        {
          amount: -50,
          balance: 950,
          context: { id: 60_000_001, type: 'station_id' },
          date: '2026-01-01T00:00:00Z',
          description: 'Market transaction',
          journalId: 40,
          reason: null,
          referenceType: 'market_transaction',
          taxAmount: null,
        },
      ],
      page: 2,
      totalPages: 2,
    },
    input: { characterId, page: 2, subjectLifecycleId },
    name: 'wallet-journal-core',
    response: [
      {
        amount: -50,
        balance: 950,
        context_id: 60_000_001,
        context_id_type: 'station_id',
        date: '2026-01-01T00:00:00Z',
        description: 'Market transaction',
        id: 40,
        ref_type: 'market_transaction',
      },
    ],
  },
  {
    expected: {
      fromId: null,
      nextFromId: null,
      transactions: [
        {
          date: '2026-01-01T00:00:00Z',
          isBuy: true,
          journalRefId: 11,
          locationId: 1_000_000_000_000,
          locationName: null,
          quantity: 5,
          totalPrice: 50,
          transactionId: 50,
          typeId: 34,
          typeName: 'Unknown type 34',
          unitPrice: 10,
        },
      ],
    },
    input: { characterId, fromId: null, subjectLifecycleId },
    name: 'wallet-transactions-core',
    response: [
      {
        client_id: 8,
        date: '2026-01-01T00:00:00Z',
        is_buy: true,
        is_personal: true,
        journal_ref_id: 11,
        location_id: 1_000_000_000_000,
        quantity: 5,
        transaction_id: 50,
        type_id: 34,
        unit_price: 10,
      },
    ],
  },
  {
    expected: {
      entries: [
        {
          amount: 50,
          balance: 1000,
          context: { id: 7, type: 'contract_id' },
          date: '2026-01-01T00:00:00Z',
          description: 'Contract reward',
          journalId: 41,
          reason: 'Reward',
          referenceType: 'contract_reward',
          taxAmount: 2.5,
        },
      ],
      page: 1,
      totalPages: 1,
    },
    headers: { 'X-Pages': '1' },
    input: { characterId, page: 1, subjectLifecycleId },
    name: 'wallet-journal-core',
    response: [
      {
        amount: 50,
        balance: 1000,
        context_id: 7,
        context_id_type: 'contract_id',
        date: '2026-01-01T00:00:00Z',
        description: 'Contract reward',
        id: 41,
        reason: 'Reward',
        ref_type: 'contract_reward',
        tax: 2.5,
      },
    ],
  },
  {
    expected: [
      {
        allianceId: 10,
        allianceName: 'Resolved 10',
        isDeleted: true,
        recordId: 3,
        startDate: '2026-01-02T00:00:00Z',
      },
    ],
    input: { corporationId: 7 },
    name: 'corporation-alliance-history-core',
    response: [
      {
        alliance_id: 10,
        is_deleted: true,
        record_id: 3,
        start_date: '2026-01-02T00:00:00Z',
      },
    ],
  },
  {
    expected: [
      {
        corporation: { id: 9, isNpc: true, name: 'Resolved 9' },
        isDeleted: false,
        recordId: 3,
        startDate: '2026-01-02T00:00:00Z',
      },
    ],
    input: { characterId },
    name: 'employment-history-core',
    response: [
      {
        corporation_id: 9,
        is_deleted: false,
        record_id: 3,
        start_date: '2026-01-02T00:00:00Z',
      },
    ],
  },
  {
    expected: { solarSystemId: 30_000_142 },
    input: { characterId, subjectLifecycleId },
    name: 'character-location-core',
    response: { solar_system_id: 30_000_142 },
  },
  {
    expected: { fromId: 50, nextFromId: 1, transactions: [] },
    input: { characterId, fromId: 50, subjectLifecycleId },
    name: 'wallet-transactions-core',
    response: Array.from({ length: 2500 }, (_, index) => ({
      client_id: 8,
      date: '2026-01-01T00:00:00Z',
      is_buy: true,
      is_personal: false,
      journal_ref_id: 11,
      location_id: 1_000_000_000_000,
      quantity: 1,
      transaction_id: index + 1,
      type_id: 34,
      unit_price: 10,
    })),
  },
  {
    expected: {
      messages: [
        {
          isRead: true,
          labelIds: [1, 2],
          mailId: 61,
          recipients: [{ id: 9, name: 'Resolved 9', type: 'corporation' }],
          sender: { id: 8, name: 'Resolved 8', type: 'character' },
          sentAt: '2026-01-01T00:00:00Z',
          subject: 'Subject',
        },
      ],
      nextLastMailId: null,
    },
    input: { characterId, labels: [1], lastMailId: 100, subjectLifecycleId },
    name: 'mail-headers-core',
    response: [
      {
        from: 8,
        is_read: true,
        labels: [1, 2],
        mail_id: 61,
        recipients: [{ recipient_id: 9, recipient_type: 'corporation' }],
        subject: 'Subject',
        timestamp: '2026-01-01T00:00:00Z',
      },
    ],
  },
  {
    expected: {
      body: null,
      isRead: false,
      labelIds: [1],
      mailId: 61,
      recipients: [{ id: 10, name: 'Resolved 10', type: 'alliance' }],
      sender: { id: 8, name: 'Resolved 8', type: 'character' },
      sentAt: '2026-01-01T00:00:00Z',
      subject: 'Subject',
    },
    input: { characterId, mailId: 61, subjectLifecycleId },
    name: 'mail-message-core',
    response: {
      body: '',
      from: 8,
      labels: [1],
      read: false,
      recipients: [{ recipient_id: 10, recipient_type: 'alliance' }],
      subject: 'Subject',
      timestamp: '2026-01-01T00:00:00Z',
    },
  },
  {
    expected: { labels: [], totalUnreadCount: null },
    input: { characterId, subjectLifecycleId },
    name: 'mail-labels-core',
    response: {},
  },
  {
    expected: [
      { id: 10, name: 'Resolved 10', type: 'alliance' },
      { id: 8, name: 'Resolved 8', type: 'character' },
      { id: 9, name: 'Resolved 9', type: 'corporation' },
    ],
    input: { characterId, search: 'pilot', subjectLifecycleId },
    name: 'character-search-mail',
    response: { alliance: [10], character: [8], corporation: [9] },
  },
  {
    expected: [
      {
        corporation: { id: 1, isNpc: true, name: 'Deleted corporation' },
        isDeleted: true,
        recordId: 2,
        startDate: '2026-01-01T00:00:00Z',
      },
    ],
    input: { characterId },
    name: 'employment-history-core',
    response: [
      { corporation_id: 1, is_deleted: true, record_id: 2, start_date: '2026-01-01T00:00:00Z' },
    ],
  },
  {
    expected: {
      messages: [
        {
          isRead: false,
          labelIds: [1],
          mailId: 60,
          recipients: [],
          sender: null,
          sentAt: '2026-01-01T00:00:00Z',
          subject: 'Subject',
        },
      ],
      nextLastMailId: null,
    },
    input: { characterId, labels: null, lastMailId: null, subjectLifecycleId },
    name: 'mail-headers-core',
    response: [
      {
        is_read: false,
        labels: [1],
        mail_id: 60,
        subject: 'Subject',
        timestamp: '2026-01-01T00:00:00Z',
      },
    ],
  },
  {
    expected: [{ allianceId: 10, characterId, corporationId: 9 }],
    input: { body: [characterId] },
    name: 'bulk-affiliation-core',
    response: [{ alliance_id: 10, character_id: characterId, corporation_id: 9 }],
  },
  {
    expected: {
      roles: ['Director'],
      rolesAtBase: ['Accountant'],
      rolesAtHeadquarters: ['Station_Manager'],
      rolesAtOther: ['Personnel_Manager'],
    },
    input: { affiliationPeriodRevision, characterId, subjectLifecycleId },
    name: 'character-corporation-roles-core',
    response: {
      roles: ['Director'],
      roles_at_base: ['Accountant'],
      roles_at_hq: ['Station_Manager'],
      roles_at_other: ['Personnel_Manager'],
    },
  },
  {
    expected: { executorCorporationId: 7, name: 'Alliance', ticker: 'ALLY' },
    input: { allianceId: 10 },
    name: 'public-alliance-core',
    response: {
      creator_corporation_id: 9,
      creator_id: 8,
      date_founded: '2026-01-01T00:00:00Z',
      executor_corporation_id: 7,
      name: 'Alliance',
      ticker: 'ALLY',
    },
  },
  {
    expected: {
      players: 10_000,
      serverVersion: '1.2.3',
      startedAt: '2026-01-01T00:00:00Z',
      vip: false,
    },
    input: {},
    name: 'esi-status-core',
    response: {
      players: 10_000,
      server_version: '1.2.3',
      start_time: '2026-01-01T00:00:00Z',
      vip: false,
    },
  },
  {
    expected: {
      accruedRemapCooldownDate: null,
      bonusRemaps: 0,
      charisma: 19,
      intelligence: 20,
      lastRemapDate: null,
      memory: 21,
      perception: 22,
      willpower: 23,
    },
    input: { characterId, subjectLifecycleId },
    name: 'character-attributes-core',
    response: { charisma: 19, intelligence: 20, memory: 21, perception: 22, willpower: 23 },
  },
  {
    expected: {
      homeLocation: null,
      jumpClones: [
        {
          implantTypeIds: [],
          jumpCloneId: 11,
          location: { locationId: 1_000_000_000_000, locationType: 'structure' },
          name: null,
        },
      ],
      lastCloneJumpAt: null,
      lastStationChangeAt: null,
    },
    input: { characterId, subjectLifecycleId },
    name: 'character-clones-core',
    response: {
      jump_clones: [
        {
          implants: [],
          jump_clone_id: 11,
          location_id: 1_000_000_000_000,
          location_type: 'structure',
        },
      ],
    },
  },
  {
    expected: { skills: [], totalSp: 0, unallocatedSp: 0 },
    input: { characterId, subjectLifecycleId },
    name: 'character-skills-core',
    response: { skills: [], total_sp: 0 },
  },
  {
    expected: { entries: [] },
    input: { characterId, subjectLifecycleId },
    name: 'character-skill-queue-core',
    response: [],
  },
  {
    expected: { roles: [], rolesAtBase: [], rolesAtHeadquarters: [], rolesAtOther: [] },
    input: { affiliationPeriodRevision, characterId, subjectLifecycleId },
    name: 'character-corporation-roles-core',
    response: {},
  },
  {
    expected: [{ allianceId: null, characterId, corporationId: 9 }],
    input: { body: [characterId] },
    name: 'bulk-affiliation-core',
    response: [{ character_id: characterId, corporation_id: 9 }],
  },
  {
    expected: { executorCorporationId: null, name: 'Alliance', ticker: 'ALLY' },
    input: { allianceId: 10 },
    name: 'public-alliance-core',
    response: {
      creator_corporation_id: 9,
      creator_id: 8,
      date_founded: '2026-01-01T00:00:00Z',
      name: 'Alliance',
      ticker: 'ALLY',
    },
  },
  {
    expected: {
      contracts: [
        {
          acceptedAt: '2026-01-02T00:00:00Z',
          availability: 'public',
          buyout: 50,
          collateral: 40,
          completedAt: '2026-01-03T00:00:00Z',
          contractId: 21,
          daysToComplete: 3,
          endLocationId: 2,
          expiredAt: '2026-02-01T00:00:00Z',
          issuedAt: '2026-01-01T00:00:00Z',
          price: 30,
          reward: 20,
          role: 'issued',
          startLocationId: 1,
          status: 'finished',
          title: 'Complete',
          type: 'item_exchange',
          volume: 10,
        },
      ],
      page: 1,
      totalPages: 1,
    },
    input: { characterId, page: 1, subjectLifecycleId },
    name: 'character-contracts-core',
    response: [
      {
        acceptor_id: 8,
        assignee_id: 6,
        availability: 'public',
        buyout: 50,
        collateral: 40,
        contract_id: 21,
        date_accepted: '2026-01-02T00:00:00Z',
        date_completed: '2026-01-03T00:00:00Z',
        date_expired: '2026-02-01T00:00:00Z',
        date_issued: '2026-01-01T00:00:00Z',
        days_to_complete: 3,
        end_location_id: 2,
        for_corporation: false,
        issuer_corporation_id: 9,
        issuer_id: 10,
        price: 30,
        reward: 20,
        start_location_id: 1,
        status: 'finished',
        title: 'Complete',
        type: 'item_exchange',
        volume: 10,
      },
      {
        acceptor_id: 8,
        assignee_id: 6,
        availability: 'corporation',
        contract_id: 22,
        date_expired: '2026-02-01T00:00:00Z',
        date_issued: '2026-01-01T00:00:00Z',
        for_corporation: true,
        issuer_corporation_id: 9,
        issuer_id: 10,
        status: 'outstanding',
        type: 'courier',
      },
    ],
  },
  {
    expected: {
      items: [
        {
          blueprint: 'original',
          direction: 'requested',
          isSingleton: true,
          quantity: 1,
          recordId: 2,
          typeId: 35,
          typeName: 'Unknown type 35',
        },
        {
          blueprint: null,
          direction: 'requested',
          isSingleton: false,
          quantity: 2,
          recordId: 3,
          typeId: 36,
          typeName: 'Unknown type 36',
        },
      ],
    },
    input: { characterId, contractId: 20, subjectLifecycleId },
    name: 'character-contract-items-core',
    response: [
      {
        is_included: false,
        is_singleton: true,
        quantity: 1,
        raw_quantity: -1,
        record_id: 2,
        type_id: 35,
      },
      { is_included: false, is_singleton: false, quantity: 2, record_id: 3, type_id: 36 },
    ],
  },
  {
    expected: {
      entries: [
        {
          amount: null,
          balance: null,
          context: null,
          date: '2026-01-01T00:00:00Z',
          description: 'Invalid context',
          journalId: 42,
          reason: null,
          referenceType: 'market_transaction',
          taxAmount: null,
        },
      ],
      page: 1,
      totalPages: 1,
    },
    headers: { 'X-Pages': '1' },
    input: { characterId, page: 1, subjectLifecycleId },
    name: 'wallet-journal-core',
    response: [
      {
        context_id: 0,
        context_id_type: 'station_id',
        date: '2026-01-01T00:00:00Z',
        description: 'Invalid context',
        id: 42,
        ref_type: 'market_transaction',
      },
    ],
  },
  {
    expected: {
      body: 'Body',
      isRead: true,
      labelIds: [1],
      mailId: 60,
      recipients: [],
      sender: null,
      sentAt: '2026-01-01T00:00:00Z',
      subject: 'Subject',
    },
    input: { characterId, mailId: 60, subjectLifecycleId },
    name: 'mail-message-core',
    response: {
      body: '<b>Body</b>',
      labels: [1],
      read: true,
      subject: 'Subject',
      timestamp: '2026-01-01T00:00:00Z',
    },
  },
  {
    expected: {
      labels: [{ color: '#ffffff', labelId: 1, name: 'Inbox', unreadCount: 2 }],
      totalUnreadCount: 2,
    },
    input: { characterId, subjectLifecycleId },
    name: 'mail-labels-core',
    response: {
      labels: [{ color: '#ffffff', label_id: 1, name: 'Inbox', unread_count: 2 }],
      total_unread_count: 2,
    },
  },
  {
    expected: [{ mailingListId: 9, name: 'List' }],
    input: { characterId, subjectLifecycleId },
    name: 'mail-lists-core',
    response: [{ mailing_list_id: 9, name: 'List' }],
  },
  {
    expected: [],
    input: { characterId, search: 'pilot', subjectLifecycleId },
    name: 'character-search-mail',
    response: { alliance: [], character: [], corporation: [] },
  },
  {
    expected: 12.5,
    input: { characterId, characterIds: [8], subjectLifecycleId },
    name: 'character-cspa-charge-mail',
    response: 12.5,
    status: 201,
  },
  {
    expected: { characterId, mailId: 70 },
    input: {
      characterId,
      input: { body: 'Body', recipients: [{ id: 8, type: 'character' }], subject: 'Subject' },
      subjectLifecycleId,
    },
    name: 'mail-send-core',
    response: 70,
    status: 201,
  },
  {
    expected: { characterId, labelId: 71 },
    input: { characterId, input: { color: '#ffffff', name: 'Inbox' }, subjectLifecycleId },
    name: 'mail-create-label-core',
    response: 71,
    status: 201,
  },
  {
    expected: { characterId, mailId: 60 },
    input: { characterId, input: { read: true }, mailId: 60, subjectLifecycleId },
    name: 'mail-update-core',
    response: undefined,
    status: 204,
  },
  {
    expected: { characterId, mailId: 60 },
    input: { characterId, mailId: 60, subjectLifecycleId },
    name: 'mail-delete-core',
    response: undefined,
    status: 204,
  },
  {
    expected: { characterId, labelId: 1 },
    input: { characterId, labelId: 1, subjectLifecycleId },
    name: 'mail-delete-label-core',
    response: undefined,
    status: 204,
  },
]

describe('registered representation mapping', () => {
  test('case table covers the registered production representation catalog', () => {
    const registeredProductionNames = [...gatewayMocks.callables.keys()].filter(
      (name) => !name.startsWith('runtime-'),
    )
    const coveredNames = [...new Set(cases.map(({ name }) => name))]

    expect(coveredNames.toSorted()).toStrictEqual(registeredProductionNames.toSorted())
  })

  test.each(cases)(
    '$name maps a controlled raw ESI response through the runtime',
    async (fixture) => {
      const fetch = vi.fn()
      const runtime = createRuntimeTestExecution(
        createRuntimeTestPorts({
          fetch,
          headers: fixture.headers,
          response: fixture.response,
          status: fixture.status,
        }),
      )
      gatewayMocks.getProductionRuntime.mockResolvedValue(runtime)
      const caller = gatewayMocks.callables.get(fixture.name)
      if (!caller) {
        throw new Error(`Missing registered ESI caller ${fixture.name}`)
      }

      const result = await caller.execute(fixture.input)
      expect(cacheSchemaAcceptsResult(caller, result, fixture.name)).toBe(true)

      const comparableResult =
        caller.execution === 'mutation'
          ? { data: result, source: 'mutation', stale: false }
          : result
      const expectedSource = caller.execution === 'mutation' ? 'mutation' : 'esi'

      expect(comparableResult).toMatchObject({
        data: fixture.expected,
        source: expectedSource,
        stale: false,
      })
      expect(fetch).toHaveBeenCalledOnce()
      await runtime.close()
    },
  )

  test('binds warm corporation-role cache entries to the affiliation period', async () => {
    const fetch = vi.fn()
    const runtime = createRuntimeTestExecution(
      createRuntimeTestPorts({ fetch, response: { roles: ['Director'] } }),
    )
    gatewayMocks.getProductionRuntime.mockResolvedValue(runtime)
    const caller = gatewayMocks.callables.get('character-corporation-roles-core')
    if (!caller) {
      throw new Error('Missing registered corporation-role caller')
    }
    const previousPeriod = { affiliationPeriodRevision, characterId, subjectLifecycleId }

    await expect(caller.execute(previousPeriod)).resolves.toMatchObject({ source: 'esi' })
    await expect(caller.execute(previousPeriod)).resolves.toMatchObject({ source: 'cache' })
    expect(fetch).toHaveBeenCalledOnce()

    await expect(
      caller.execute({
        ...previousPeriod,
        affiliationPeriodRevision: '33333333-3333-4333-8333-333333333333',
      }),
    ).resolves.toMatchObject({ source: 'esi' })
    expect(fetch).toHaveBeenCalledTimes(2)
    await runtime.close()
  })

  test('rejects an unknown wallet journal reference type', () => {
    const schema = gatewayMocks.callables.get('wallet-journal-core')?.cacheSchema
    if (!schema) {
      throw new Error('Missing wallet journal cache schema')
    }

    expect(
      schema.safeParse({
        entries: [
          {
            amount: null,
            balance: null,
            context: null,
            date: '2026-01-01T00:00:00Z',
            description: '',
            journalId: 40,
            reason: null,
            referenceType: 'not-a-wallet-reference-type',
            taxAmount: null,
          },
        ],
        page: 1,
        totalPages: 1,
      }).success,
    ).toBe(false)
  })
})

function cacheSchemaAcceptsResult(caller: CapturedEsiCallable, result: unknown, name: string) {
  if (caller.execution === 'mutation') {
    return true
  }
  if (!caller.cacheSchema) {
    throw new Error(`Missing cache schema for ${name}`)
  }
  if (typeof result !== 'object' || result === null || !('data' in result)) {
    throw new Error(`Missing read result data for ${name}`)
  }
  return caller.cacheSchema.safeParse(result.data).success
}

function marketOrder() {
  return {
    duration: 3,
    is_corporation: false,
    issued: '2026-01-01T00:00:00Z',
    location_id: 1_000_000_000_000,
    order_id: 30,
    price: 7.5,
    range: 'station',
    region_id: 10_000_002,
    type_id: 34,
    volume_remain: 2,
    volume_total: 4,
  }
}

function mappedMarketOrder() {
  return {
    durationDays: 3,
    escrow: null,
    expiresAt: '2026-01-04T00:00:00.000Z',
    isBuy: false,
    issuedAt: '2026-01-01T00:00:00Z',
    locationId: 1_000_000_000_000,
    locationName: null,
    minimumVolume: null,
    orderId: 30,
    price: 7.5,
    range: 'station',
    regionId: 10_000_002,
    typeId: 34,
    typeName: 'Unknown type 34',
    volumeRemain: 2,
    volumeTotal: 4,
  }
}
