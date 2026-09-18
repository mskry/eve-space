import type {
  PlatformCharacterResourceSubject,
  PlatformResourceOperationImplementation,
} from '@eve-space/platform-module-contract/resources'
import { maintainEvidence } from './evidence-maintenance.js'
import type {
  CurrentSnapshotPersistence,
  EvidenceCollectionPersistence,
  EvidenceMaintenancePersistence,
  EvidenceMaterializationPersistence,
} from './persistence.js'

type WalletEvidenceResource<Operation extends string> = PlatformResourceOperationImplementation<
  Operation,
  unknown,
  unknown,
  string,
  unknown,
  PlatformCharacterResourceSubject,
  readonly [],
  EvidenceCollectionPersistence,
  EvidenceMaterializationPersistence,
  EvidenceMaintenancePersistence
>

export const walletBalanceResource: PlatformResourceOperationImplementation<
  'wallet-balance',
  unknown,
  unknown,
  string,
  unknown,
  PlatformCharacterResourceSubject,
  readonly [],
  object,
  CurrentSnapshotPersistence,
  EvidenceMaintenancePersistence
> = {
  operation: 'wallet-balance',
  request(subject) {
    return { path: { character_id: subject.characterId } }
  },
  map({ data }) {
    return data
  },
  async materialize() {
    return { outcome: 'obsolete' }
  },
  maintain(context) {
    return maintainEvidence('wallet-balance', context, false)
  },
}

export const walletJournalResource: WalletEvidenceResource<'wallet-journal'> = {
  operation: 'wallet-journal',
  request(subject) {
    return { path: { character_id: subject.characterId } }
  },
  map({ data }) {
    return data
  },
  async materialize() {
    return { outcome: 'obsolete' }
  },
  maintain(context) {
    return maintainEvidence('wallet-journal', context, false)
  },
}

export const walletTransactionsResource: WalletEvidenceResource<'wallet-transactions'> = {
  operation: 'wallet-transactions',
  request(subject) {
    return { path: { character_id: subject.characterId } }
  },
  map({ data }) {
    return data
  },
  async materialize() {
    return { outcome: 'obsolete' }
  },
  maintain(context) {
    return maintainEvidence('wallet-transactions', context, false)
  },
}
