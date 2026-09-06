import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

describe('ESI client quality workflow', () => {
  let workflow: string;
  let rootCoverageWorkflow: string;

  beforeAll(async () => {
    [workflow, rootCoverageWorkflow] = await Promise.all(
      ['esi-client.yml', 'coverage.yml'].map(async (name) =>
        (
          await readFile(new URL(`../../../.github/workflows/${name}`, import.meta.url), 'utf8')
        ).replaceAll('\r\n', '\n'),
      ),
    );
  });

  it('runs for package and root toolchain changes', () => {
    for (const path of [
      '.github/workflows/esi-client.yml',
      '.github/workflows/esi-client-publish.yml',
      '.node-version',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'packages/esi-client/**',
    ]) {
      expect(workflow.match(new RegExp(`- '${escapeRegex(path)}'`, 'g'))).toHaveLength(2);
    }
  });

  it('preserves cross-platform validation and adds one Ubuntu coverage analysis', () => {
    expect(workflow).toContain('os: [ubuntu-latest, windows-latest]');
    expect(workflow).toMatch(
      /^  analysis:\n    name: ESI client analysis\n    runs-on: ubuntu-latest$/m,
    );
    expect(workflow.match(/node-version-file: '\.node-version'/g)).toHaveLength(2);
    expect(workflow.match(/pnpm install --frozen-lockfile/g)).toHaveLength(2);
    expect(workflow.match(/pnpm --filter @evespace\/esi-client test:coverage/g)).toHaveLength(1);
    expect(workflow).toContain('path: packages/esi-client/coverage/lcov.info');
    expect(workflow).toContain('if-no-files-found: error');
    expect(workflow).toContain('retention-days: 14');
  });

  it('scans only the package with its dedicated credential', () => {
    expect(workflow.match(/SonarSource\/sonarqube-scan-action@v8/g)).toHaveLength(1);
    expect(workflow).toContain('projectBaseDir: packages/esi-client');
    expect(workflow).toContain('-Dsonar.projectKey=mskry_eve-space_esi-client');
    expect(workflow).toContain('-Dsonar.organization=mskry');
    expect(workflow).toContain('SONAR_TOKEN: ${{ secrets.ESI_CLIENT_SONAR_TOKEN }}');
    expect(workflow).not.toContain('secrets.SONAR_TOKEN');
  });

  it('skips secret-backed analysis only for fork pull requests', () => {
    expect(workflow.match(/github\.event\.pull_request\.head\.repo\.fork == false/g)).toHaveLength(
      2,
    );
    expect(workflow).toContain('ESI_CLIENT_SONAR_TOKEN is required for trusted ESI analysis.');
    expect(workflow).toMatch(/if \[ -z "\$ESI_CLIENT_SONAR_TOKEN" \]; then[\s\S]*?exit 1/);
  });

  it('leaves root coverage complete and free of package-owned inputs', () => {
    expect(rootCoverageWorkflow).not.toContain('@evespace/esi-client test:coverage');
    expect(rootCoverageWorkflow).not.toContain('packages/esi-client/coverage/lcov.info');
    expect(rootCoverageWorkflow).toContain('SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}');
    expect(rootCoverageWorkflow).toContain('-Dsonar.projectKey=mskry_eve-space');
    for (const report of [
      'coverage/**/lcov.info',
      'coverage-registry/lcov.info',
      'api/coverage/lcov.info',
      'api/coverage-postgres/lcov.info',
      'api/coverage-redis/lcov.info',
      'packages/platform-module-nuxt/coverage/lcov.info',
    ]) {
      expect(rootCoverageWorkflow).toContain(report);
    }
  });
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
