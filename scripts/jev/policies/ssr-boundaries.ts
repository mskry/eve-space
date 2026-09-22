import type { Questions } from '@typesafe-ai/sdk'

export const ssrBoundaryPolicy = {
  ssr_boundary:
    'A Nuxt request that can execute during server-side rendering and reaches a route requiring a credential is a defect unless it is disabled during SSR behind the applicable client/authentication/ownership gate, or it explicitly forwards the incoming request cookie header.',
  cookie_forwarding:
    "credentials: 'include' does not forward browser cookies from a server-side fetch. Only an explicit cookie header taken from the incoming event request counts as forwarding.",
  not_reportable:
    'Public health, status, and authorization-configuration requests; browser-event mutations that cannot execute during SSR; protected queries carrying the applicable client/authentication/ownership gate; and SSR requests that explicitly forward the incoming cookie.',
} as const

export const ssrBoundaryQuestions = {
  ssr_capable: {
    type: 'noul',
    instructions:
      'The request in `call_site.code` can execute on the server while Nuxt renders this route, rather than only in the browser. Account for any enabling condition in `query_definition.code` or in a predicate shown in `local_helpers`, because a query composes its definition, its local gate helpers, and its call site together.',
    criteria: {
      true: 'It runs during component setup, in a composable called from setup, in a route middleware, or in a prefetch or recovery path that runs on the server, and nothing disables it on the server.',
      false:
        'It runs only from a browser event handler, only inside onMounted, or it is disabled on the server by an enabling condition in either the call site or the query definition.',
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
      true: "credentials: 'include' or the shared credentialed client is the only credential mechanism shown.",
      false:
        'An explicit incoming cookie header is forwarded, or no credential mechanism is shown at all.',
    },
  },
  excluded_public_endpoint: {
    type: 'noul',
    instructions:
      'The request in `resolved_request` targets a health, status, or authorization-configuration endpoint that `policy.not_reportable` excludes from review.',
  },
} as const satisfies Questions
