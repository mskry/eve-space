import type { EntryType } from '@typesafe-ai/sdk'
import type { RequestSite } from './request-sites.js'
import type { RouteDefinition } from './route-definitions.js'
import { evaluateSystemOne, type JevClient } from '../jev/client.js'
import { ssrBoundaryPolicy, ssrBoundaryQuestions } from '../jev/policies/ssr-boundaries.js'

export interface SiteState {
  site: RequestSite
  rootMiddleware: readonly string[]
  route: RouteDefinition | null
}

export interface SiteJudgment {
  ssrCapable: number
  credentialRequirement: { choice: string; confidence: number }
  ssrSafePath: { choice: string; confidence: number }
  credentialsIncludeOnly: number
  excludedPublicEndpoint: number
}

export const judgeSite = async (client: JevClient, state: SiteState): Promise<SiteJudgment> => {
  const answers = await evaluateSystemOne(client, toState(state), ssrBoundaryQuestions)

  return {
    credentialRequirement: {
      choice: answers.credential_requirement.choice,
      confidence: answers.credential_requirement.confidence,
    },
    credentialsIncludeOnly: answers.credentials_include_only.noul,
    excludedPublicEndpoint: answers.excluded_public_endpoint.noul,
    ssrCapable: answers.ssr_capable.noul,
    ssrSafePath: {
      choice: answers.ssr_safe_path.choice,
      confidence: answers.ssr_safe_path.confidence,
    },
  }
}

const toState = ({ site, rootMiddleware, route }: SiteState): EntryType => ({
  call_site: { code: site.excerpt, entry: site.entry, file: site.file, line: site.line },
  local_helpers: site.localHelpers ?? 'No local helper definitions were captured.',
  policy: ssrBoundaryPolicy,
  query_definition: site.definitionExcerpt
    ? { source: site.definitionSource, code: site.definitionExcerpt }
    : 'This call site does not compose a shared query definition.',
  resolved_request: site.requestPath
    ? { method: site.method, path: site.requestPath }
    : 'The request path could not be resolved statically from the call site.',
  route: route
    ? {
        source: route.source,
        method: route.method,
        path: route.path,
        root_middleware: [...rootMiddleware],
        code: route.excerpt,
      }
    : 'No mounted route definition was located for this call site.',
})
