import type {
  PlatformResourceOperationImplementation,
  PlatformResourceSubject,
} from '@eve-space/platform-module-contract/resources'
import { collectActivityResource } from './collection.js'
import { materializeActivityResource } from './collection-store.js'
import type { ActivityObservation } from './collection-types.js'
import type {
  ActivityCheckpointPersistence,
  ActivityMaterializationPersistence,
} from './persistence.js'

type ActivityResource = PlatformResourceOperationImplementation<
  string,
  unknown,
  ActivityObservation,
  string,
  unknown,
  PlatformResourceSubject,
  readonly [],
  ActivityCheckpointPersistence,
  ActivityMaterializationPersistence,
  object
>

export const campaignsResource: ActivityResource = {
  operation: 'organization-activity-campaign-list',
  request() {
    return {}
  },
  map() {
    throw new Error('Activity resources require bounded collection')
  },
  collect(context) {
    return collectActivityResource(
      { id: 'campaigns', rootOperation: 'campaign-list', paginated: false },
      context,
    )
  },
  materialize: materializeActivityResource,
}

export const publicJobsResource: ActivityResource = {
  operation: 'organization-activity-job-list',
  request() {
    return {}
  },
  map() {
    throw new Error('Activity resources require bounded collection')
  },
  collect(context) {
    return collectActivityResource(
      { id: 'public-jobs', rootOperation: 'job-list', paginated: true },
      context,
    )
  },
  materialize: materializeActivityResource,
}

export const corporationJobsResource: ActivityResource = {
  operation: 'organization-activity-corporation-jobs',
  request() {
    return {}
  },
  map() {
    throw new Error('Activity resources require bounded collection')
  },
  collect(context) {
    return collectActivityResource(
      { id: 'corporation-jobs', rootOperation: 'corporation-jobs', paginated: true },
      context,
    )
  },
  materialize: materializeActivityResource,
}

export const corporationProjectsResource: ActivityResource = {
  operation: 'organization-activity-project-list',
  request() {
    return {}
  },
  map() {
    throw new Error('Activity resources require bounded collection')
  },
  collect(context) {
    return collectActivityResource(
      { id: 'corporation-projects', rootOperation: 'project-list', paginated: true },
      context,
    )
  },
  materialize: materializeActivityResource,
}

export const characterJobsResource: ActivityResource = {
  operation: 'organization-activity-character-jobs',
  request() {
    return {}
  },
  map() {
    throw new Error('Activity resources require bounded collection')
  },
  collect(context) {
    return collectActivityResource(
      { id: 'character-jobs', rootOperation: 'character-jobs', paginated: false },
      context,
    )
  },
  materialize: materializeActivityResource,
}

export const characterCampaignsResource: ActivityResource = {
  operation: 'organization-activity-character-objectives',
  request() {
    return {}
  },
  map() {
    throw new Error('Activity resources require bounded collection')
  },
  collect(context) {
    return collectActivityResource(
      { id: 'character-campaigns', rootOperation: 'character-objectives', paginated: true },
      context,
    )
  },
  materialize: materializeActivityResource,
}

export const characterProjectsResource: ActivityResource = {
  operation: 'organization-activity-project-list',
  request() {
    return {}
  },
  map() {
    throw new Error('Activity resources require bounded collection')
  },
  collect(context) {
    return collectActivityResource(
      { id: 'character-projects', rootOperation: 'project-list', paginated: true },
      context,
    )
  },
  materialize: materializeActivityResource,
}
