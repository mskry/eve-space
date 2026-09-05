import { generatedDocumentationEmitter } from './documentation-emitter.ts';
import { generatedExamplesEmitter } from './examples-emitter.ts';
import type { GeneratedOutputEmitter } from './generation-contracts.ts';
import { generatedTargets, type GeneratedTarget } from './paths.ts';
import { generatedSourceEmitter } from './source-emitter.ts';
import { generatedTestsEmitter } from './test-emitter.ts';

/**
 * The emitters that produce generated output offline, and the targets they are required to
 * claim. Declared once so `generate` and `generate:check` cannot run different sets: a check
 * that emitted less than the generator would report a clean tree for stale output.
 */
export const offlineEmitters: readonly GeneratedOutputEmitter[] = Object.freeze([
  generatedSourceEmitter,
  generatedDocumentationEmitter,
  generatedExamplesEmitter,
  generatedTestsEmitter,
]);

/** Every target except `openapi/generated`, which is written directly rather than by an emitter. */
export const emittedTargets: readonly GeneratedTarget[] = Object.freeze(
  generatedTargets.filter(({ role }) => role !== 'openapi'),
);
