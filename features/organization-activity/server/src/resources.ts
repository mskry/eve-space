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
  collect(context) {
    return collectActivityResource(
      { id: 'campaigns', rootOperation: 'campaign-list', paginated: false },
      context,
    )
  },
  materialize: materializeActivityResource,
  mode: 'bounded-collection',
  operation: 'organization-activity-campaign-list',
}

export const publicJobsResource: ActivityResource<'job-list', 'job-detail'> = {
  collect(context) {
    return collectActivityResource(
      { id: 'public-jobs', rootOperation: 'job-list', paginated: true },
      context,
    )
  },
  materialize: materializeActivityResource,
  mode: 'bounded-collection',
  operation: 'organization-activity-job-list',
}

export const corporationJobsResource: ActivityResource<'corporation-jobs'> = {
  collect(context) {
    return collectActivityResource(
      { id: 'corporation-jobs', rootOperation: 'corporation-jobs', paginated: true },
      context,
    )
  },
  materialize: materializeActivityResource,
  mode: 'bounded-collection',
  operation: 'organization-activity-corporation-jobs',
}

export const corporationProjectsResource: ActivityResource<'project-list', 'project-detail'> = {
  collect(context) {
    return collectActivityResource(
      { id: 'corporation-projects', rootOperation: 'project-list', paginated: true },
      context,
    )
  },
  materialize: materializeActivityResource,
  mode: 'bounded-collection',
  operation: 'organization-activity-project-list',
}

export const characterJobsResource: ActivityResource<'character-jobs', 'job-participation'> = {
  collect(context) {
    return collectActivityResource(
      { id: 'character-jobs', rootOperation: 'character-jobs', paginated: false },
      context,
    )
  },
  materialize: materializeActivityResource,
  mode: 'bounded-collection',
  operation: 'organization-activity-character-jobs',
}

export const characterCampaignsResource: ActivityResource<
  'character-objectives',
  'objective-participation'
> = {
  collect(context) {
    return collectActivityResource(
      { id: 'character-campaigns', rootOperation: 'character-objectives', paginated: true },
      context,
    )
  },
  materialize: materializeActivityResource,
  mode: 'bounded-collection',
  operation: 'organization-activity-character-objectives',
}

export const characterProjectsResource: ActivityResource<'project-list', 'project-contribution'> = {
  collect(context) {
    return collectActivityResource(
      { id: 'character-projects', rootOperation: 'project-list', paginated: true },
      context,
    )
  },
  materialize: materializeActivityResource,
  mode: 'bounded-collection',
  operation: 'organization-activity-project-list',
}
