# EVE Space Fetching Review Instructions

## Code Review Rules

- For fetching, ESI integration, query caching, or browser persistence reviews, follow [the fetching-layer compliance checklist](docs/fetching-layer-compliance-checklist.md). Record evidence and unresolved policy conflicts using its report format.

### Nuxt/API Execution Boundaries

- Review every changed Nuxt request together with the final Hono route as mounted in `api/src/index.ts`. Do not infer access requirements from feature-router comments or from whether the underlying ESI data is public.
- For each changed `useQuery`, `$fetch`, `useFetch`, `useAsyncData`, prefetch, mutation, or direct Hono client call, determine whether it can execute during SSR and whether the final route requires an application session, administrator session, owned character, or other credential.
- Report an SSR-capable request to a protected route unless it explicitly forwards the incoming request cookie. `credentials: 'include'` does not forward browser cookies from a server-side fetch.
- Valid safe paths are to disable the protected query during SSR with `import.meta.client` and apply the required client-side authentication or ownership gate, or to explicitly forward only the incoming `cookie` header when SSR is intentional. Genuinely public routes may use SSR normally.
- Do not report public SSR requests such as health, status, or authorization configuration; browser-event mutations that cannot execute during SSR; protected queries with the applicable client/authentication/ownership gate; or SSR requests that explicitly forward the incoming cookie.
- Findings must identify both the Nuxt call site and the Hono middleware or route mount that establishes the violated boundary.
