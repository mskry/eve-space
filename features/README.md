# First-Party Features

Installed features are listed explicitly in `installed-modules.json`. A feature uses this layout:

```text
features/<module-id>/
  module.config.ts
  server/
    package.json
    src/
    migrations/
  nuxt/
    package.json
    src/module.ts
    src/runtime/app/
    test/fixtures/
```

`module.config.ts` is a serializable descriptor with type-only imports from
`@eve-space/platform-module-contract`. It must not import either runtime package. The API and worker
depend only on `server`; the root Nuxt application depends only on `nuxt`.

Feature server code receives platform capabilities and must not import API source directly. Repository
verification rejects imports of the core database client, auth/session stores, token services, routes,
or any other path under `api/src`.

Every descriptor declares a default platform icon. Navigation entries inherit it unless they
declare an explicit icon override.

## Install Or Remove A Feature

Installation is static. Adding a directory is not enough:

1. Add or remove the module ID in `installed-modules.json`.
2. Add or remove the server package from `api/package.json` and the Nuxt package from the root `package.json`.
3. Run `pnpm registry:generate` and `pnpm registry:check`.
4. Run `pnpm test:packaging` to verify the API image and combined Nuxt build.
5. Deploy rebuilt API/worker and Nuxt artifacts.

Runtime enablement is a separate deployment-administrator setting. Disable a module and let replicas
converge before uninstalling it. Uninstallation does not erase retained module data; destructive
removal requires a reviewed forward operator migration. See
[`docs/platform-module-foundation.md`](../docs/platform-module-foundation.md) for the complete
lifecycle and failure procedure.
