# Local SonarQube

The `local-sonarqube` Compose project is a reusable SonarQube Community Build instance for projects on this machine. Its PostgreSQL database, search data, extensions, and logs use dedicated persistent volumes and do not share storage with EVE Space.

## Start the service

```bash
docker compose -f compose.sonar.yml up -d
docker compose -f compose.sonar.yml ps
curl http://localhost:9000/api/system/status
```

The one-shot `host-requirements` service configures OrbStack's Linux VM for the embedded Elasticsearch process and then exits. SonarQube is available only through `http://localhost:9000`.

On the first visit, sign in with `admin` / `admin` and change the administrator password. Create a local project with the key `eve-space`, generate a project analysis token, and assign the desired quality gate.

## Analyze EVE Space

```bash
pnpm quality:sonar
```

Store the project analysis token as `SONAR_TOKEN` in the ignored `.env.sonar` file. The command runs the frontend, API, platform-module, and Redis coverage suites before scanning. The scanner waits for the server-side quality gate and exits unsuccessfully if the gate fails.

Use `pnpm sonar` when current LCOV reports already exist and only another scan is needed.

## Analyze another project

Keep the shared Compose project running. In the other repository, install `@sonar/scan`, configure its own source and coverage paths, and use a unique project key and project analysis token:

```properties
sonar.projectKey=another-project
sonar.projectName=Another Project
sonar.host.url=http://localhost:9000
sonar.qualitygate.wait=true
```

Quality gates and language profiles can be reused across projects from the SonarQube administration interface. Use separate project tokens rather than an administrator or instance-wide token.

Community Build is intended for main-branch analysis. Do not scan feature branches into the main project's key; use an edition that supports branch and pull-request analysis when merge-time PR decoration is required.

## Stop the service

```bash
docker compose -f compose.sonar.yml stop
```

Do not add `--volumes` to a down command unless the SonarQube database and analysis history should be permanently deleted.
