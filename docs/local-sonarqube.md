# Local SonarQube

The `local-sonarqube` Compose project is a reusable SonarQube Community Build instance for projects on this machine. Its PostgreSQL database, search data, extensions, and logs use dedicated persistent volumes and do not share storage with EVE Space.

## Start the service

```bash
docker compose -f compose.sonar.yml up -d
docker compose -f compose.sonar.yml ps
curl http://localhost:9000/api/system/status
```

The one-shot `host-requirements` service configures OrbStack's Linux VM for the embedded Elasticsearch process and then exits. SonarQube is available only through `http://localhost:9000`.

On the first visit, sign in with `admin` / `admin` and change the administrator password. Create two local projects and assign the desired quality gate to each:

- `eve-space`, named `EVE Space`, for the application, API, registry, and platform modules
- `eve-space-esi-client`, named `EVE Space ESI Client`, for the independently published package

Generate a separate least-privilege project analysis token for each project. Do not use an administrator or instance-wide token.

## Analyze EVE Space

```bash
pnpm quality:sonar
```

Store the application project token as `SONAR_TOKEN` in the ignored root `.env.sonar` file. The command runs the frontend, API, PostgreSQL, platform-module, registry, and Redis coverage suites before scanning. The scanner waits for the application quality gate and exits unsuccessfully if the gate fails.

Use `pnpm sonar` when current LCOV reports already exist and only another scan is needed.

## Analyze the ESI client

Store the `eve-space-esi-client` project token as `SONAR_TOKEN` in the ignored `packages/esi-client/.env.sonar` file, then run:

```bash
pnpm quality:sonar:esi-client
```

Use `pnpm sonar:esi-client` when `packages/esi-client/coverage/lcov.info` already exists. The package scanner uses `packages/esi-client` as its base directory, waits for its own quality gate, and never contributes source or coverage to the root project.

In GitHub Actions, the root coverage workflow uses `SONAR_TOKEN` and retains the `coverage-reports` artifact. The path-scoped ESI workflow uses `ESI_CLIENT_SONAR_TOKEN` and retains `esi-client-coverage` for 14 days. Both secrets must be project-specific. Validation and coverage still run for fork pull requests, but secret-backed analysis is skipped; a missing package token fails explicitly on trusted events.

## Analyze another project

Keep the shared Compose project running. In the other repository, install `@sonar/scan`, configure its own source and coverage paths, and use a unique project key and project analysis token:

```properties
sonar.projectKey=another-project
sonar.projectName=Another Project
sonar.host.url=http://localhost:9000
sonar.qualitygate.wait=true
```

Quality gates and language profiles can be reused across projects from the SonarQube administration interface.

Community Build is intended for main-branch analysis. Do not scan feature branches into the main project's key; use an edition that supports branch and pull-request analysis when merge-time PR decoration is required.

## Stop the service

```bash
docker compose -f compose.sonar.yml stop
```

Do not add `--volumes` to a down command unless the SonarQube database and analysis history should be permanently deleted.
