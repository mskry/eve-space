import type {
  PlatformBoundedCollectionResourceImplementation,
  PlatformResourceSubject,
} from '@eve-space/platform-module-contract/resources'
import type {
  ActivityEsiOperation,
  ActivityOperationId,
  ActivityProtocol,
} from './activity-protocol.js'
import { collectActivityResource } from './collection.js'
import { materializeActivityResource } from './collection-store.js'
import type { ActivityObservation } from './collection-types.js'
import type {
  ActivityCheckpointPersistence,
  ActivityMaterializationPersistence,
} from './persistence.js'

type ActivityResource<
  Root extends ActivityOperationId,
  Dependents extends ActivityOperationId = never,
> = PlatformBoundedCollectionResourceImplementation<
  ActivityEsiOperation<Root>,
  ActivityProtocol<Root | Dependents>,
  ActivityObservation,
  string,
  unknown,
  PlatformResourceSubject,
  readonly [],
  ActivityCheckpointPersistence,
  ActivityMaterializationPersistence,
  object
>

export const campaignsResource: ActivityResource<
  'campaign-list',
  'campaign-detail' | 'objective-list' | 'objective-detail'
> = {
  mode: 'bounded-collection',
  operation: 'organization-activity-campaign-list',
  collect(context) {
    return collectActivityResource(
      { id: 'campaigns', rootOperation: 'campaign-list', paginated: false },
      context,
    )
  },
  materialize: materializeActivityResource,
}

export const publicJobsResource: ActivityResource<'job-list', 'job-detail'> = {
  mode: 'bounded-collection',
  operation: 'organization-activity-job-list',
  collect(context) {
    return collectActivityResource(
      { id: 'public-jobs', rootOperation: 'job-list', paginated: true },
      context,
    )
  },
  materialize: materializeActivityResource,
}

export const corporationJobsResource: ActivityResource<'corporation-jobs'> = {
  mode: 'bounded-collection',
  operation: 'organization-activity-corporation-jobs',
  collect(context) {
    return collectActivityResource(
      { id: 'corporation-jobs', rootOperation: 'corporation-jobs', paginated: true },
      context,
    )
  },
  materialize: materializeActivityResource,
}

export const corporationProjectsResource: ActivityResource<'project-list', 'project-detail'> = {
  mode: 'bounded-collection',
  operation: 'organization-activity-project-list',
  collect(context) {
    return collectActivityResource(
      { id: 'corporation-projects', rootOperation: 'project-list', paginated: true },
      context,
    )
  },
  materialize: materializeActivityResource,
}

export const characterJobsResource: ActivityResource<'character-jobs', 'job-participation'> = {
  mode: 'bounded-collection',
  operation: 'organization-activity-character-jobs',
  collect(context) {
    return collectActivityResource(
      { id: 'character-jobs', rootOperation: 'character-jobs', paginated: false },
      context,
    )
  },
  materialize: materializeActivityResource,
}

export const characterCampaignsResource: ActivityResource<
  'character-objectives',
  'objective-participation'
> = {
  mode: 'bounded-collection',
  operation: 'organization-activity-character-objectives',
  collect(context) {
    return collectActivityResource(
      { id: 'character-campaigns', rootOperation: 'character-objectives', paginated: true },
      context,
    )
  },
  materialize: materializeActivityResource,
}

export const characterProjectsResource: ActivityResource<'project-list', 'project-contribution'> = {
  mode: 'bounded-collection',
  operation: 'organization-activity-project-list',
  collect(context) {
    return collectActivityResource(
      { id: 'character-projects', rootOperation: 'project-list', paginated: true },
      context,
    )
  },
  materialize: materializeActivityResource,
}
