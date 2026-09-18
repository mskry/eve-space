import type {
  PlatformCharacterResourceSubject,
  PlatformResourceOperationImplementation,
} from '@eve-space/platform-module-contract/resources'
import { maintainEvidence } from './evidence-maintenance.js'
import type {
  EvidenceCollectionPersistence,
  EvidenceMaintenancePersistence,
  EvidenceMaterializationPersistence,
} from './persistence.js'

export const assetsResource: PlatformResourceOperationImplementation<
  'character-assets-page',
  unknown,
  unknown,
  string,
  unknown,
  PlatformCharacterResourceSubject,
  readonly ['published-type-details', 'static-location-labels'],
  EvidenceCollectionPersistence,
  EvidenceMaterializationPersistence,
  EvidenceMaintenancePersistence
> = {
  operation: 'character-assets-page',
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
    return maintainEvidence('assets', context, false)
  },
}
