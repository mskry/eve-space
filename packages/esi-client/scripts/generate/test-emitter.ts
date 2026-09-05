import { readFile, writeFile } from 'node:fs/promises';

import { format } from 'oxfmt';

import { createComponentEmitter, type GeneratedOutputComponent } from './component-emitter.ts';
import { domainClientTestsComponent } from './domain-client.ts';
import { generatedOperationContractTestsComponent } from './operation-contract-test-emitter.ts';
import type { GeneratedOutputEmitter } from './generation-contracts.ts';
import { generatedTargetFor } from './paths.ts';

export type GeneratedTestComponent = GeneratedOutputComponent;

const testsTarget = generatedTargetFor('tests').path;

async function formatGeneratedTest(outputPath: string, relativePath: string): Promise<void> {
  const source = await readFile(outputPath, 'utf8');
  const formatted = await format(relativePath, source, {
    printWidth: 100,
    singleQuote: true,
    trailingComma: 'all',
  });
  if (formatted.errors.length > 0) {
    throw new Error(`Generated test output could not be formatted: ${relativePath}`);
  }
  await writeFile(outputPath, formatted.code);
}

export function createGeneratedTestsEmitter(
  components: readonly GeneratedTestComponent[],
): GeneratedOutputEmitter {
  return createComponentEmitter({
    components,
    emitterName: 'generated-tests',
    noun: 'test',
    postProcess: formatGeneratedTest,
    target: testsTarget,
  });
}

export const generatedTestsEmitter: GeneratedOutputEmitter = createGeneratedTestsEmitter([
  generatedOperationContractTestsComponent,
  domainClientTestsComponent,
]);
