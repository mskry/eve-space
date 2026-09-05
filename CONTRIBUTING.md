# Contributing to EVE Space

Feedback, issue reports, technical review, and code contributions are all welcome. EVE Space is
under active pre-release development, so interfaces and architecture still move; opening an issue
before a large change saves rework.

## Licensing of Contributions

EVE Space is licensed under the
[GNU Affero General Public License v3.0 or later](LICENSE). Contributions are inbound under the same
terms as the project is outbound: **by submitting a pull request, you agree that your contribution is
licensed under AGPL-3.0-or-later.**

There is no contributor license agreement to sign and no copyright assignment. You keep the copyright
in what you write.

Only contribute code you have the right to license this way. Do not paste code from a source under an
incompatible license, and if your employment contract assigns your work to your employer, get their
sign-off before contributing.

Third-party dependencies must be under a license compatible with AGPL-3.0-or-later. In practice that
means MIT, ISC, Apache-2.0, BSD, or similar permissive terms; raise anything else in the pull request
so it can be reviewed before it lands.

Contributions must not include EVE Online assets, static data, or other CCP property beyond what the
[EVE Online Developer License Agreement](https://developers.eveonline.com/license-agreement) permits.
See the EVE Online Intellectual Property section of the [README](README.md) for what the project
license does and does not cover.

## Getting Set Up

Requirements, EVE application setup, environment variables, and the local run instructions are in the
[README](README.md). In short:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm stack:up
pnpm dev
```

## Engineering Guide

[`AGENTS.md`](AGENTS.md) is the authoritative engineering guide: architecture boundaries, API and
contract rules, Vue and Nuxt conventions, schema ownership, authentication and security
requirements, ESI and caching rules, and persistence rules. Read the sections relevant to your change
before you start. Preserve the documented architecture and security boundaries unless the change is
explicitly about changing them.

Two rules cause the most review churn, so they are worth repeating here:

- **Never commit `.env`.** Document every new setting in `.env.example`.
- **Respect ESI caching.** Do not refresh a resource before its expiry, and preserve conditional
  requests, cooldowns, and error-budget handling. Bypassing ESI caching can get the application's
  access revoked.

## Specs

Larger changes are developed spec-first under [`openspec/`](openspec). `openspec/specs/` holds the
current capability specs and `openspec/changes/` holds in-flight proposals with their tasks. If your
change adds or alters a capability rather than fixing a bug, propose it there first so the spec and
the implementation land together.

## Checks

[Lefthook](lefthook.yml) runs lint, formatting, knip, and the test suites on commit, and adds
typecheck plus the coverage, Redis, and PostgreSQL suites on push. The checks are repository-wide
rather than staged-file-scoped on purpose. Run `pnpm install` at least once so the hooks are
installed.

To run the core checks yourself:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:frontend
pnpm test:api
pnpm test:modules
pnpm test:redis
pnpm test:postgres
pnpm test:packaging
```

Use `pnpm lint:fix` and `pnpm format` for the mechanical fixes, and `pnpm knip` to find unreachable
code. The Redis and PostgreSQL suites need a working Docker Engine because they run against real
containers.

New behavior needs tests. The API coverage suite enforces 80% lines, functions, and statements and
75% branches, and CI will fail the pull request below those thresholds.

## Pull Requests

- Branch from `main` and keep each pull request to one coherent change.
- Use [Conventional Commits](https://www.conventionalcommits.org) for commit subjects, matching the
  existing history: `feat(api): ...`, `fix: ...`, `ci: ...`, `docs: ...`.
- Say what changed and why, and note any new environment variable, migration, or ESI scope.
- Add schema changes as new ordered migrations. Never rewrite a migration that has already been
  applied.
- Make sure `CI` and `Coverage` are green before asking for review. Changes to the ESI client or its toolchain must also pass the path-scoped `ESI Client` validation and package quality gate.

## Security

Do not open a public issue for a security vulnerability. Report it privately to skrypets@gmail.com
with enough detail to reproduce it, and allow time for a fix before any public disclosure.
