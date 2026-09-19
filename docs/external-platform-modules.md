# External Platform Modules

External platform modules are operator-selected, build-time extensions. A selected release executes
inside the EVE Space API, worker, Nuxt build, and browser application. The package boundary limits
declared dependencies and supplied capabilities, but it is not a JavaScript sandbox. Install a
release only after trusting its publisher, registry, source-review process, and locked artifacts.

## Publisher Contract

A release consists of three packages with the same semantic version:

| Package  | Required surface                                                       | Runtime boundary       |
| -------- | ---------------------------------------------------------------------- | ---------------------- |
| Manifest | One JSON export, normally `./manifest`                                 | Build-time data only   |
| Server   | Root JavaScript/types export and declared `./migrations/*` SQL exports | API and worker         |
| Nuxt     | Root Nuxt-module export and every declared reviewer-panel export       | Nuxt build and browser |

The manifest package name is the stable publisher identity. The manifest's module ID and publisher
package jointly own permissions and retained configuration. A differently named publisher package
cannot inherit grants by declaring the same module ID.

Author the declaration with `definePlatformModuleManifest` from
`@eve-space/platform-module-contract/manifest`. It must declare:

- a stable module ID, the manifest package name, one release version, and a compatible host-contract
  range;
- the exact server and Nuxt package names;
- every server route, migration, persistence operation, resource, ESI operation, and activity
  provider;
- every Nuxt page, navigation entry, and reviewer panel;
- every module permission referenced by a contribution; and
- any optional permission profiles as non-authoritative suggestions.

The manifest package must set `sideEffects: false`, publish only its canonical JSON artifact, and
export that file without executable discovery code. Emit canonical JSON from a built declaration:

```bash
eve-space-module-manifest dist/module-manifest.js packages/manifest/manifest.json
```

The server root must export exactly the executable names declared in the manifest. Each migration
must be a regular packaged SQL file exported as `./migrations/<name>`. Server code uses only public
platform contracts and its own domain code; it cannot import API source, another feature, database,
Redis, queues, authentication, token handling, ESI transport, or a generic network client.

The Nuxt root must export exactly one default Nuxt module. Each reviewer contribution also names an
export whose default value is its panel component. Nuxt code cannot import server code, root
application internals, another feature, or direct behavior-library primitives. Shared behavior must
first become a bounded platform contract.

### Permissions And Profiles

Permission keys are namespaced by module ID. Each declaration includes its operator-facing label,
purpose, eligible audience, `standard` or `sensitive` classification, and whether it remains usable
during compliance review. A route, provider, resource presentation, action, or reviewer contribution
cannot reference an undeclared permission.

Profiles may contain only exact permissions from their owning module. They suggest a least-privilege
bundle to an organization owner; they never create a role, bundle, group, assignment, or entitlement.
Modules cannot define or grant `hr_auditor`, `director`, `organization_owner`, or deployment
administrator authority.

### Reviewer Contributions

A reviewer contribution links one declared server route to one Nuxt panel. It declares a stable ID,
exact HR or director audience, exact module permission, supported managed-account or managed-character
target, display metadata, and deterministic order. The platform owns the member directory, selected
target, authorization checks, protected-query lifecycle, workspace navigation, and accessible
asynchronous states. A panel receives only its bounded target and contribution capabilities; it must
not dispatch arbitrary operations or read another module's storage.

## Conformance And Release

Run source and package checks in the publisher repository. A source-and-installed-package config can
use package roots:

```json
{
  "manifest": { "packageRoot": "packages/manifest", "export": "./manifest" },
  "server": { "packageRoot": "packages/server", "sourceRoot": "packages/server/src" },
  "nuxt": { "packageRoot": "packages/nuxt", "sourceRoot": "packages/nuxt/src" }
}
```

Run it with human-readable or machine-readable output:

```bash
eve-space-module-conformance conformance.json
eve-space-module-conformance --json conformance.json
```

Before publishing, build all three packages without relying on consumer lifecycle scripts, emit the
canonical manifest, and pack them. Then verify the exact archives:

```json
{
  "manifest": { "archivePath": "artifacts/example-manifest-1.2.3.tgz", "export": "./manifest" },
  "server": { "archivePath": "artifacts/example-server-1.2.3.tgz" },
  "nuxt": { "archivePath": "artifacts/example-nuxt-1.2.3.tgz" }
}
```

Conformance checks source imports, package dependencies and exports, packed files, migration policy,
executable inventories, reviewer panels, and role separation. Publish the three immutable artifacts
at one version only after the archive report passes. A publisher report is evidence, not host
authority: EVE Space rechecks installed artifacts, compatibility, ownership, inventories, and final
composition.

The current host-contract version is exported as `platformModuleHostContractVersion` from
`@eve-space/platform-module-contract/manifest`. Compatible additive revisions stay within the same
major version. A breaking contract revision increments the major version and requires publisher
migration guidance and a new module release whose compatibility range includes it. Do not widen a
range until the release has passed source, archive, and host-composition tests against that contract.

## Operator Installation

Use exact package versions even when the registry permits ranges:

```bash
pnpm add --save-exact <manifest-package>@<version> <nuxt-package>@<version>
pnpm --dir api add --save-exact <server-package>@<version>
```

Add the selected manifest export to `features/installed-modules.json`:

```json
{
  "moduleId": "example-module",
  "manifest": {
    "package": "@example/example-module-manifest",
    "export": "./manifest"
  }
}
```

Then:

1. Review the package names, exact versions, resolved registry, tarball locations, integrity hashes,
   transitive dependencies, install-script policy, licenses, and complete lockfile diff.
2. Run `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm registry:generate`, and
   `pnpm registry:check`.
3. Run `pnpm test:packaging`, the relevant PostgreSQL suite, and the full verification commands in
   the engineering guide.
4. Build new API, worker, and Nuxt artifacts. Package installation alone changes no running process.
5. Deploy the release disabled, wait for API migration success and worker readiness, then enable the
   module through deployment administration.
6. Have an organization owner review the installed permission catalog. If useful, preview a profile
   and deliberately copy its exact permissions into an ordinary restricted bundle before assigning
   that bundle.

Enabling a module never adopts a profile or grants a user. A selected package absent from
`installed-modules.json` contributes nothing, and changing the selected set always requires registry
regeneration and a rebuild.

### Private Registries

Keep registry credentials in the deployment secret manager. Never commit `.npmrc`, put a token in a
package URL, Docker build argument, environment baked into an image, generated registry, or CI log.
Both production Dockerfiles accept an optional BuildKit secret:

```bash
docker build --secret id=npmrc,src=/secure/path/npmrc -t eve-space-web .
docker build --secret id=npmrc,src=/secure/path/npmrc -f api/Dockerfile -t eve-space-api .
```

The secret exists only for `pnpm install`; `.dockerignore` excludes `.npmrc`, and the runtime images
contain no registry configuration. Use a read-only, package-scoped token and revoke it after a
suspected registry or publisher compromise.

Production images install with lifecycle scripts disabled, build every package whose exports the
registry validator inspects, and only then run `pnpm registry:check`. A publisher package must not
depend on `prepare`, `postinstall`, or another consumer-side lifecycle hook to create its shipped
exports. The API and worker use pnpm's isolated production deployment graph; packaging verification
rejects Nuxt or Nuxt-module dependencies in that server runtime.

## Upgrade, Disablement, Removal, And Rollback

For an upgrade, inspect the publisher changelog and compatibility range, update all three direct
dependencies to the same exact release, review lockfile identity changes, regenerate registries, and
repeat packaging, migration, readiness, and permission review. A changed profile does not alter an
already adopted bundle. New permissions require another owner decision.

To disable or remove a module:

1. Disable it through deployment administration and wait for API, worker, and browser convergence.
2. Verify its routes, reviewer panels, navigation, and scheduling are unavailable while unrelated
   modules continue to work.
3. Record the retention decision for its schema and private data.
4. For removal, delete its selection and the three direct dependencies, update the lockfile,
   regenerate registries, rebuild, and redeploy.
5. Review retained permission entries. They remain attributed to the original publisher/module and
   inert; an organization owner may explicitly remove them through normal audited bundle editing.

Uninstallation does not erase schemas, migration ledgers, settings, audit history, or module-owned
data. Permanent cleanup requires a separate reviewed forward operator migration after no deployed
artifact references the module.

Rollback first disables the affected module. Restore the prior reviewed lockfile, installed-module
selection, generated registries, and application source, then rebuild and redeploy all three host
artifacts. Retained data and permission entries remain bound to their original identity. Do not
rewrite applied migrations or let a different publisher inherit stale grants; destructive database
rollback is a separate recovery decision based on a pre-deployment backup.

## Generated And Runtime Data Boundary

Generated registries contain only validated declaration data, exact package names and versions, and
lockfile integrity identities. They never contain registry URLs with credentials, package tokens,
archive or package-root paths, `.npmrc` content, module private records, session or EVE tokens, or
encryption material. Package provenance is server build inventory; it is not copied into queue jobs,
telemetry, or browser runtime configuration. Browser-visible permission and reviewer metadata is the
bounded catalog needed for administration and authorized workspace composition, not module private
data.

Host validation errors identify stable package, module, contribution, and policy identities. Treat a
failure that exposes a credential, absolute source path, private DTO, or registry secret as a release
blocker. Rotate the credential, remove the artifact or log, and correct the build before deployment.

## Release Verification Matrix

Use the deterministic suites for lifecycle states that require alternate package selections or
database histories, and use Compose for the final production artifact and readiness probe.

| Flow                                                                        | Verification                                                                                                                                                                                   |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Valid and invalid archive installation                                      | `pnpm test:registry:coverage` exercises packed non-workspace releases, malformed artifacts, stale publisher reports, collisions, and final composition.                                        |
| Enablement, disablement, profile adoption, and review access                | API, frontend, and module coverage suites exercise administrator mutation, exact profile copying, permission checks, disabled workspace gating, and reviewer route isolation.                  |
| Upgrade, removal, retained permissions, publisher replacement, and rollback | PostgreSQL coverage exercises migration upgrades, static uninstall retention, publisher-bound inert grants, explicit retained-entry removal, and transactional rollback.                       |
| Production migration and worker readiness                                   | `docker compose build api worker`, followed by `docker compose up -d --no-build api worker` and `docker compose ps`, must leave API, worker, PostgreSQL, Queue Redis, and Cache Redis healthy. |

The 2026-09-19 verification rebuilt the API and worker images from lifecycle-script-free installs,
validated all 13 generated registries inside the image build, applied startup migrations, and reached
healthy API and worker checks. Local probes returned `200` for `/health`, `/api/status`, and
`/api/modules`, `401` for an unauthenticated reviewer-directory request, and canonical `400` JSON for
an invalid public type identifier.
