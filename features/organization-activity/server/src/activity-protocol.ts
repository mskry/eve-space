import type { PlatformExecutableEsiOperationProtocol } from '@eve-space/platform-module-server'
import type {
  campaignDetailOperation,
  campaignListOperation,
  characterJobsOperation,
  characterObjectivesOperation,
  corporationJobsOperation,
  jobDetailOperation,
  jobListOperation,
  jobParticipationOperation,
  objectiveDetailOperation,
  objectiveListOperation,
  objectiveParticipationOperation,
  projectContributionOperation,
  projectDetailOperation,
  projectListOperation,
} from './operations.js'

export const activityOperationIds = [
  'campaign-list',
  'campaign-detail',
  'objective-list',
  'objective-detail',
  'job-list',
  'job-detail',
  'corporation-jobs',
  'project-list',
  'project-detail',
  'project-contribution',
  'character-jobs',
  'job-participation',
  'character-objectives',
  'objective-participation',
] as const

export type ActivityOperationId = (typeof activityOperationIds)[number]
export type ActivityEsiOperation<Operation extends ActivityOperationId = ActivityOperationId> =
  `organization-activity-${Operation}`

type ActivityEsiOperationDefinitions = {
  readonly 'organization-activity-campaign-list': typeof campaignListOperation
  readonly 'organization-activity-campaign-detail': typeof campaignDetailOperation
  readonly 'organization-activity-objective-list': typeof objectiveListOperation
  readonly 'organization-activity-objective-detail': typeof objectiveDetailOperation
  readonly 'organization-activity-job-list': typeof jobListOperation
  readonly 'organization-activity-job-detail': typeof jobDetailOperation
  readonly 'organization-activity-corporation-jobs': typeof corporationJobsOperation
  readonly 'organization-activity-project-list': typeof projectListOperation
  readonly 'organization-activity-project-detail': typeof projectDetailOperation
  readonly 'organization-activity-project-contribution': typeof projectContributionOperation
  readonly 'organization-activity-character-jobs': typeof characterJobsOperation
  readonly 'organization-activity-job-participation': typeof jobParticipationOperation
  readonly 'organization-activity-character-objectives': typeof characterObjectivesOperation
  readonly 'organization-activity-objective-participation': typeof objectiveParticipationOperation
}

export type ActivityProtocol<Operations extends ActivityOperationId> =
  PlatformExecutableEsiOperationProtocol<
    ActivityEsiOperationDefinitions,
    ActivityEsiOperation<Operations>
  >

export type ActivityOperationData<Operation extends ActivityOperationId> =
  ActivityProtocol<Operation>[ActivityEsiOperation<Operation>]['output']
