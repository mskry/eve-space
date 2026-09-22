import type { Questions } from '@typesafe-ai/sdk'

export const esiUsagePolicy = {
  operation:
    'The registered SDK operation, encoded request, mapped result, representation name, and surrounding feature purpose must describe the same ESI resource and action.',
  identity:
    'Cache identity must include every normalized input that can change the upstream response or mapped result. Set identity is valid only when input order and duplicates cannot change meaning.',
  cache:
    'Character-owned data must use private generation-bound caching. Public ESI data remains public when consumed by a protected workflow. A no-cache contract is safe from cache disclosure. Mutations and deliberately uncached operations must not gain read caching.',
  version:
    'A changed cached representation meaning requires a representation-version increment. Mapping, filtering, normalization, or cache-schema changes can change meaning even when the ESI operation is unchanged.',
} as const

export const esiUsageQuestions = {
  operation_fit: {
    type: 'choice',
    instructions:
      'Does `representation.current_definition` select and adapt an ESI operation that matches the purpose visible in `representation.context`, `catalog.current_contract`, and `catalog.current_metadata`?',
    criteria: {
      aligned:
        'The operation, request fields, result mapping, representation name, and feature purpose all describe the same resource and action.',
      mismatch:
        'The selected operation, request encoding, or mapped response serves a materially different resource or action from the representation and surrounding feature.',
      unclear: 'The supplied code does not establish the representation purpose or operation fit.',
    },
  },
  identity_fit: {
    type: 'choice',
    instructions:
      'Compare request construction in `representation.current_definition` with identity configuration in `catalog.current_contract`. Does cache identity distinguish every input that can change the upstream or mapped result?',
    criteria: {
      complete:
        'Every response-varying scalar is represented and collection order is discarded only when order and duplicates cannot change meaning.',
      incomplete:
        'A response-varying input is omitted, nullable states collapse incorrectly, or set identity discards meaningful order or duplicates.',
      unclear: 'The request-to-identity relationship cannot be established from the evidence.',
    },
  },
  cache_fit: {
    type: 'choice',
    instructions:
      'Does the cache and freshness configuration in `catalog.current_contract` and `catalog.current_metadata` fit the data sensitivity, mutation behavior, and feature purpose shown by the representation?',
    criteria: {
      aligned:
        'Public/private classification, freshness, retention, stale behavior, and mutation caching are appropriate. A no-cache contract is aligned, and public ESI data remains public even when its consumer is protected.',
      unsafe:
        'Private data can enter public or insufficiently bound caching, a mutation is cached as a read, or stale behavior can expose private data outside its authorization generation.',
      questionable:
        'The policy appears inefficient or potentially too stale for the feature, but the evidence does not show a clear privacy or mutation-safety defect.',
      unclear: 'The evidence is insufficient to judge cache behavior.',
    },
  },
  version_fit: {
    type: 'choice',
    instructions:
      'Compare current and previous representation and catalog evidence. If cached result meaning changed through mapping, filtering, normalization, schema, or identity semantics, was the representation version advanced?',
    criteria: {
      not_applicable:
        'This is a new representation, there is no previous evidence, or no cached representation meaning changed.',
      aligned: 'Cached meaning changed and the representation version also changed.',
      bump_missing: 'Cached meaning changed while the representation version remained unchanged.',
      unclear:
        'The evidence suggests a possible semantic change but does not establish version handling.',
    },
  },
} as const satisfies Questions
