import { describe, expect, test } from 'vitest'
import { projectWalletJournalEntry, projectWalletTransactions } from '../src/wallet.js'

describe('wallet projection', () => {
  test('allows only reviewed context fields', () => {
    expect(
      projectWalletJournalEntry({
        id: 1,
        date: '2026-09-17T10:00:00Z',
        ref_type: 'market_transaction',
        description: 'Safe description',
        context_id: 7,
        context_id_type: 'character_id',
      }),
    ).toMatchObject({ journalId: 1, context: null })
  })

  test('keeps personal safe fields, fallbacks, and deterministic ordering', () => {
    const projected = projectWalletTransactions(
      [
        {
          transaction_id: 2,
          journal_ref_id: 20,
          date: '2026-09-16T10:00:00Z',
          type_id: 35,
          quantity: 2,
          unit_price: 3,
          is_buy: true,
          is_personal: true,
          location_id: 60_003_760,
        },
        {
          transaction_id: 3,
          journal_ref_id: 30,
          date: '2026-09-17T10:00:00Z',
          type_id: 34,
          quantity: 1,
          unit_price: 4,
          is_buy: false,
          is_personal: true,
          location_id: 60_003_761,
        },
        {
          transaction_id: 4,
          journal_ref_id: 40,
          date: '2026-09-18T10:00:00Z',
          type_id: 36,
          quantity: 1,
          unit_price: 5,
          is_buy: false,
          is_personal: false,
          location_id: 60_003_762,
        },
      ],
      new Map([[34, 'Tritanium']]),
      new Map([[60_003_761, 'Jita IV - Moon 4']]),
    )

    expect(projected.map(({ transactionId }) => transactionId)).toEqual([3, 2])
    expect(projected[0]).toMatchObject({ typeName: 'Tritanium', totalPrice: 4 })
    expect(projected[1]).toMatchObject({ typeName: 'Unknown type 35', locationName: null })
  })
})
