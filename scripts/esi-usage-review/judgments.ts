import type { ChoiceResponse, EntryType } from '@typesafe-ai/sdk'
import type { EsiCatalogEvidence } from './catalog-evidence.js'
import type { EsiUsageSite } from './sites.js'
import { evaluateSystemOne, type JevClient } from '../jev/client.js'
import { esiUsagePolicy, esiUsageQuestions } from '../jev/policies/esi-usage.js'

interface ChoiceJudgment {
  readonly choice: string
  readonly confidence: number
}

export interface EsiUsageJudgment {
  readonly operationFit: ChoiceJudgment
  readonly identityFit: ChoiceJudgment
  readonly cacheFit: ChoiceJudgment
  readonly versionFit: ChoiceJudgment
}

export interface EsiUsageState {
  readonly site: EsiUsageSite
  readonly catalog: EsiCatalogEvidence
}

export async function judgeEsiUsage(
  client: JevClient,
  state: EsiUsageState,
): Promise<EsiUsageJudgment> {
  const answers = await evaluateSystemOne(client, toModelState(state), esiUsageQuestions)
  return {
    cacheFit: answer(answers.cache_fit),
    identityFit: answer(answers.identity_fit),
    operationFit: answer(answers.operation_fit),
    versionFit: answer(answers.version_fit),
  }
}

function toModelState({ site, catalog }: EsiUsageState): EntryType {
  return {
    catalog: {
      current_cache_kind: catalog.cacheKind,
      current_contract: catalog.contract ?? 'No current core catalog contract was found.',
      current_metadata: catalog.metadata ?? 'No current core operation metadata was found.',
      previous_contract: catalog.previousContract ?? 'No previous core catalog contract was found.',
      previous_metadata:
        catalog.previousMetadata ?? 'No previous core operation metadata was found.',
    },
    policy: esiUsagePolicy,
    representation: {
      context: site.context,
      current_definition: site.definition,
      factory: site.factory,
      file: site.file,
      line: site.line,
      name: site.name,
      operation: site.operation,
      previous_definition: site.previousDefinition ?? 'No previous representation was found.',
    },
  }
}

function answer(value: ChoiceResponse): ChoiceJudgment {
  return { choice: value.choice, confidence: value.confidence }
}
