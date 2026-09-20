import type { RequestSite } from './request-sites.js'
import type { RouteDefinition } from './route-definitions.js'

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone'
const MODEL = 'jev-latest'

const POLICY = {
  ssr_boundary:
    'A Nuxt request that can execute during server-side rendering and reaches a route requiring a credential is a defect unless it is disabled during SSR behind the applicable client/authentication/ownership gate, or it explicitly forwards the incoming request cookie header.',
  cookie_forwarding:
    "credentials: 'include' does not forward browser cookies from a server-side fetch. Only an explicit cookie header taken from the incoming event request counts as forwarding.",
  not_reportable:
    'Public health, status, and authorization-configuration requests; browser-event mutations that cannot execute during SSR; protected queries carrying the applicable client/authentication/ownership gate; and SSR requests that explicitly forward the incoming cookie.',
} as const

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

export const judgeSite = async (apiKey: string, state: SiteState): Promise<SiteJudgment> => {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, state: toState(state), questions: QUESTIONS }),
  })

  if (!response.ok)
    throw new Error(`TypeSafe request failed (${response.status}): ${await response.text()}`)

  const { answers } = (await response.json()) as SystemOneResponse

  return {
    ssrCapable: answers.ssr_capable.noul,
    credentialRequirement: {
      choice: answers.credential_requirement.choice,
      confidence: answers.credential_requirement.confidence,
    },
    ssrSafePath: {
      choice: answers.ssr_safe_path.choice,
      confidence: answers.ssr_safe_path.confidence,
    },
    credentialsIncludeOnly: answers.credentials_include_only.noul,
    excludedPublicEndpoint: answers.excluded_public_endpoint.noul,
  }
}

interface SystemOneResponse {
  answers: {
    ssr_capable: { noul: number }
    credential_requirement: { choice: string; confidence: number }
    ssr_safe_path: { choice: string; confidence: number }
    credentials_include_only: { noul: number }
    excluded_public_endpoint: { noul: number }
  }
}

const QUESTIONS = {
  ssr_capable: {
    type: 'noul',
    instructions:
      'The request in `call_site.code` can execute on the server while Nuxt renders this route, rather than only in the browser. Account for any enabling condition in `query_definition.code` or in a predicate shown in `local_helpers`, because a query composes its definition, its local gate helpers, and its call site together.',
    criteria: {
      yes: 'It runs during component setup, in a composable called from setup, in a route middleware, or in a prefetch or recovery path that runs on the server, and nothing disables it on the server.',
      no: 'It runs only from a browser event handler, only inside onMounted, or it is disabled on the server by an enabling condition in either the call site or the query definition.',
    },
  },
  credential_requirement: {
    type: 'choice',
    instructions:
      'Judge what the mounted Hono route in `route.code` requires before it serves this request, using `route.root_middleware` and the middleware named in the route definition itself. Ignore whether the underlying EVE data is publicly available.',
    criteria: {
      public: 'No session, ownership, or permission middleware applies; anyone may call it.',
      application_session:
        'A member application session is required, but no character ownership or organization permission.',
      owned_character: 'The caller must own the character identified in the path.',
      organization_permission:
        'Organization version, compliance, audience, or a named permission is enforced.',
      administrator_session: 'A deployment-administrator session is required.',
      unknown: 'The provided route code does not show what the route requires.',
    },
  },
  ssr_safe_path: {
    type: 'choice',
    instructions:
      'Judge which safe path, if any, this request already takes so that it cannot reach a credentialed route without a credential during server-side rendering. The gate may appear in `call_site.code`, in `query_definition.code`, or in a predicate defined in `local_helpers` that the call site invokes; any of those locations counts.',
    criteria: {
      client_only_gate:
        'Execution is disabled during SSR and gated on client-side authentication or ownership, for example an enabled condition combining `import.meta.client` with an authentication, ownership, or organization-access predicate, in either the call site or the query definition.',
      cookie_forwarded:
        'The request explicitly forwards the incoming request cookie header when running on the server.',
      browser_event_only:
        'The request cannot execute during SSR at all because it only runs from a browser event.',
      none: 'No such gate or forwarding is present in the shown code.',
    },
  },
  credentials_include_only: {
    type: 'noul',
    instructions:
      "The code in `call_site.code` relies on credentials: 'include' (or an equivalent client credential option) as its means of sending the session, without explicitly forwarding the incoming cookie header on the server.",
    criteria: {
      yes: "credentials: 'include' or the shared credentialed client is the only credential mechanism shown.",
      no: 'An explicit incoming cookie header is forwarded, or no credential mechanism is shown at all.',
    },
  },
  excluded_public_endpoint: {
    type: 'noul',
    instructions:
      'The request in `resolved_request` targets a health, status, or authorization-configuration endpoint that `policy.not_reportable` excludes from review.',
  },
} as const

const toState = ({ site, rootMiddleware, route }: SiteState) => ({
  call_site: { file: site.file, line: site.line, entry: site.entry, code: site.excerpt },
  local_helpers: site.localHelpers ?? 'No local helper definitions were captured.',
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
        root_middleware: rootMiddleware,
        code: route.excerpt,
      }
    : 'No mounted route definition was located for this call site.',
  policy: POLICY,
})
