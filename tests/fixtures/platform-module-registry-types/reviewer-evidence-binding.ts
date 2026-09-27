import {
  readMailEvidenceOperation,
  readWalletEvidenceOperation,
} from '../../../features/member-audit/server/src/persistence.js'
import { memberWalletRoutes } from '../../../features/member-audit/server/src/routes.js'

type WalletBinding = Parameters<typeof memberWalletRoutes>[1]

void ({
  operation: readWalletEvidenceOperation,
  resources: [
    { resourceId: 'wallet-balance', field: 'balance' },
    { resourceId: 'wallet-journal', field: 'journal' },
    { resourceId: 'wallet-transactions', field: 'transactions' },
  ],
} satisfies WalletBinding)

void ({
  // @ts-expect-error the route cannot bind to a different persistence result
  operation: readMailEvidenceOperation,
  resources: [
    { resourceId: 'wallet-balance', field: 'balance' },
    { resourceId: 'wallet-journal', field: 'journal' },
    { resourceId: 'wallet-transactions', field: 'transactions' },
  ],
} satisfies WalletBinding)

void ({
  operation: readWalletEvidenceOperation,
  resources: [
    { resourceId: 'wallet-balance', field: 'balance' },
    // @ts-expect-error the journal binding cannot read the transaction field
    { resourceId: 'wallet-journal', field: 'transactions' },
    { resourceId: 'wallet-transactions', field: 'transactions' },
  ],
} satisfies WalletBinding)
