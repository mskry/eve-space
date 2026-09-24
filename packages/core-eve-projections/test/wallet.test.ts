import { describe, expect, test } from 'vitest'
import { projectWalletJournalEntry, projectWalletTransactions } from '../src/wallet.js'

describe('wallet projection', () => {
  test('allows only reviewed context fields', () => {
    expect(
      projectWalletJournalEntry({
        context_id: 7,
        context_id_type: 'character_id',
        date: '2026-09-17T10:00:00Z',
        description: 'Safe description',
        id: 1,
        ref_type: 'market_transaction',
      }),
    ).toMatchObject({ context: null, journalId: 1 })
  })

  test('keeps personal safe fields, fallbacks, and deterministic ordering', () => {
    const projected = projectWalletTransactions(
      [
        {
          date: '2026-09-16T10:00:00Z',
          is_buy: true,
          is_personal: true,
          journal_ref_id: 20,
          location_id: 60_003_760,
          quantity: 2,
          transaction_id: 2,
          type_id: 35,
          unit_price: 3,
        },
        {
          date: '2026-09-17T10:00:00Z',
          is_buy: false,
          is_personal: true,
          journal_ref_id: 30,
          location_id: 60_003_761,
          quantity: 1,
          transaction_id: 3,
          type_id: 34,
          unit_price: 4,
        },
        {
          date: '2026-09-18T10:00:00Z',
          is_buy: false,
          is_personal: false,
          journal_ref_id: 40,
          location_id: 60_003_762,
          quantity: 1,
          transaction_id: 4,
          type_id: 36,
          unit_price: 5,
        },
      ],
      new Map([[34, 'Tritanium']]),
      new Map([[60_003_761, 'Jita IV - Moon 4']]),
    )

    expect(projected.map(({ transactionId }) => transactionId)).toStrictEqual([3, 2])
    expect(projected[0]).toMatchObject({ totalPrice: 4, typeName: 'Tritanium' })
    expect(projected[1]).toMatchObject({ locationName: null, typeName: 'Unknown type 35' })
  })
})
