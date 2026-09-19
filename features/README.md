# First-Party Features

First-party releases use the same package-export installation model as external releases. Their
source layout is:

```text
features/<module-id>/
  manifest/
    package.json
    manifest.json
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

The pure manifest package exports canonical JSON and must not import either runtime package. The API
and worker depend only on `server`; the root Nuxt application depends on the manifest and `nuxt`.

Feature server code receives platform capabilities and must not import API source directly. Repository
verification rejects imports of the core database client, auth/session stores, token services, routes,
or any other path under `api/src`. It also rejects direct core-data contract or implementation
imports, unrestricted SDE datasets, ESI clients, alternate canonical source adapters, and competing
product caches.

Routes, scheduled resources, and activity providers declare exact `coreDataProducts` dependencies
in `module.config.ts`. Each contribution receives only those product-specific methods in its runtime
capability. Use the returned canonical DTO and revision or observation metadata; do not create a
module-owned SDE alias or generic product dispatcher. A coverage-manifest entry does not grant a
product, ESI scope, schedule, or permission to persist data. See
[`docs/platform-module-foundation.md`](../docs/platform-module-foundation.md) for product promotion
and protected-product requirements.

Every descriptor declares a default platform icon. Navigation entries inherit it unless they
declare an explicit icon override.

## Install Or Remove A Feature

Installation is static. Adding a directory is not enough:

1. Add or remove the module ID and manifest package export in `installed-modules.json`.
2. Add or remove the server package from `api/package.json` and the manifest and Nuxt packages from
   the root `package.json`.
3. Run `pnpm registry:generate` and `pnpm registry:check`.
4. Run `pnpm test:packaging` to verify the API image and combined Nuxt build.
5. Deploy rebuilt API/worker and Nuxt artifacts.

Runtime enablement is a separate deployment-administrator setting. Disable a module and let replicas
converge before uninstalling it. Uninstallation does not erase retained module data; destructive
removal requires a reviewed forward operator migration. See
[`docs/platform-module-foundation.md`](../docs/platform-module-foundation.md) for the complete
lifecycle and failure procedure. External publishers and deployment operators must also follow
[`docs/external-platform-modules.md`](../docs/external-platform-modules.md).
