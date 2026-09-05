import { readFile } from 'node:fs/promises';

import { beforeAll, describe, expect, it } from 'vitest';

import { assertSupportedNpmVersion } from '../scripts/verify-npm-version.ts';

describe('ESI client trusted publication workflow', () => {
  let workflow: string;

  beforeAll(async () => {
    workflow = (
      await readFile(
        new URL('../../../.github/workflows/esi-client-publish.yml', import.meta.url),
        'utf8',
      )
    ).replaceAll('\r\n', '\n');
  });

  it('runs only for scoped package tags without cancellation', () => {
    expect(workflow).toMatch(/^      - '@evespace\/esi-client@\*'$/m);
    expect(workflow).not.toMatch(/^\s+branches:/m);
    expect(workflow).toContain('group: esi-client-publish-${{ github.ref }}');
    expect(workflow).toContain('cancel-in-progress: false');
  });

  it('builds one candidate under the minimum supported runtime', () => {
    const validate = job('validate');
    expect(validate).toContain('node-version: 22.18.0');
    expect(validate).toContain('fetch-depth: 0');
    expect(validate).toContain('persist-credentials: false');
    expect(validate).toContain('pnpm install --frozen-lockfile');
    expect(validate).toContain('release:validate');
    expect(validate).toContain('release:candidate');
    expect(validate).toContain('git diff --exit-code');
    expect(validate).not.toContain('npm publish');
    expect(validate).not.toContain('id-token: write');
  });

  it('grants OIDC only to the dependent protected publish job', () => {
    const publish = job('publish');
    expect(workflow.match(/id-token: write/g)).toHaveLength(1);
    expect(publish).toContain('needs: validate');
    expect(publish).toContain('environment: npm');
    expect(publish).toContain('node-version: 24');
    expect(publish).toContain('actions/download-artifact@v4');
    expect(publish).toContain('Require npm 11.5.1 or newer');
    expect(workflow.match(/name: esi-client-release-candidate/g)).toHaveLength(2);
    expect(workflow).not.toContain('name: esi-client-release-${{ github.ref_name }}');
    expect(publish.indexOf('verify-release-candidate.ts')).toBeLessThan(
      publish.indexOf('npm publish release/package.tgz --access public'),
    );
  });

  it('has no token fallback, repacking, forced publish, install, or prerelease channel', () => {
    const publish = job('publish');
    expect(workflow).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
    expect(publish).not.toMatch(/npm (?:install|ci|pack)/);
    expect(publish).not.toContain('--force');
    expect(publish).not.toMatch(/--tag\s+(?!"?\$GITHUB_REF_NAME)/);
    expect(publish).not.toContain('--provenance');
  });

  it.each(['11.5.1', '11.6.0', '12.0.0'])('accepts supported stable npm %s', (version) => {
    expect(() => assertSupportedNpmVersion(version)).not.toThrow();
  });

  it.each(['11.5.0', '10.99.99', '11.5', '11.5.1-beta.0', 'unknown'])(
    'rejects unsupported or malformed npm %s',
    (version) => {
      expect(() => assertSupportedNpmVersion(version)).toThrow('npm');
    },
  );

  function job(name: string): string {
    const marker = `  ${name}:\n`;
    const start = workflow.indexOf(marker);
    if (start < 0) throw new Error(`Missing workflow job: ${name}`);
    const remaining = workflow.slice(start + marker.length);
    const nextJob = remaining.search(/^  [a-z][^\n]*:\n/m);
    return workflow.slice(start, nextJob < 0 ? undefined : start + marker.length + nextJob);
  }
});
