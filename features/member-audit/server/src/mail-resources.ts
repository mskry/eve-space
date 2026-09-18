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

type MailResource<Operation extends string> = PlatformResourceOperationImplementation<
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

export const mailHeadersResource: MailResource<'mail-headers'> = {
  operation: 'mail-headers',
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
    return maintainEvidence('mail-headers', context, false)
  },
}

export const mailDetailsResource: MailResource<'mail-message'> = {
  operation: 'mail-message',
  request() {
    throw new Error('Mail detail collection requires a continuation checkpoint')
  },
  map({ data }) {
    return data
  },
  async materialize() {
    return { outcome: 'obsolete' }
  },
  maintain(context) {
    return maintainEvidence('mail-contents', context, false)
  },
}
