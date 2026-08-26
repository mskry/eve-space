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
