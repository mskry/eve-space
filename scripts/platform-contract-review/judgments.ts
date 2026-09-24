import type { ChoiceResponse, EntryType } from '@typesafe-ai/sdk'
import { evaluateSystemOne, type JevClient } from '../jev/client.js'
import {
  platformContractPolicy,
  platformContractQuestions,
} from '../jev/policies/platform-contracts.js'
import type { PlatformContractEvidence } from './evidence.js'

export interface ChoiceJudgment {
  readonly choice: string
  readonly confidence: number
}

export interface PlatformContractJudgment {
  readonly purposeFit: ChoiceJudgment
  readonly audienceFit: ChoiceJudgment
  readonly permissionFit: ChoiceJudgment
  readonly targetFit: ChoiceJudgment
  readonly sensitivityFit: ChoiceJudgment
}

export async function judgePlatformContract(
  client: JevClient,
  evidence: PlatformContractEvidence,
): Promise<PlatformContractJudgment> {
  const answers = await evaluateSystemOne(client, toModelState(evidence), platformContractQuestions)
  return {
    audienceFit: choice(answers.audience_fit),
    permissionFit: choice(answers.permission_fit),
    purposeFit: choice(answers.purpose_fit),
    sensitivityFit: choice(answers.sensitivity_fit),
    targetFit: choice(answers.target_fit),
  }
}

function toModelState(evidence: PlatformContractEvidence): EntryType {
  return {
    contract: {
      manifest_source: `${evidence.manifestFile}:${evidence.manifestLine}`,
      module_id: evidence.moduleId,
      permission: evidence.permission ?? 'No matching permission declaration was found.',
      reviewer_contribution:
        evidence.reviewerContribution ?? 'No reviewer contribution is declared for this route.',
      route: {
        audience: evidence.route.audience,
        authorization: evidence.route.authorization,
        code: evidence.route.code,
        export_name: evidence.route.exportName,
        exposure: evidence.route.exposure,
        id: evidence.route.id,
        namespace: evidence.route.namespace,
        required_permission: evidence.route.requiredPermission,
        section_id: evidence.route.sectionId,
        target: evidence.route.target,
      },
      section: evidence.section ?? 'No section is declared for this route.',
    },
    host_composition:
      evidence.composition || 'No applicable host route composer implementation was found.',
    implementation: {
      code: evidence.implementation.code ?? 'No route implementation was found.',
      source:
        evidence.implementation.file && evidence.implementation.line
          ? `${evidence.implementation.file}:${evidence.implementation.line}`
          : 'No route implementation was found.',
    },
    policy: platformContractPolicy,
  }
}

function choice(answer: ChoiceResponse): ChoiceJudgment {
  return { choice: answer.choice, confidence: answer.confidence }
}
