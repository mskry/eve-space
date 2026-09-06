import { createComponentEmitter, type GeneratedOutputComponent } from './component-emitter.ts';
import { domainClientSourceComponent } from './domain-client.ts';
import { heyApiSourceComponent } from './hey-api.ts';
import { operationRegistrySourceComponent } from './operation-registry.ts';
import type { GeneratedOutputEmitter } from './generation-contracts.ts';
import { generatedTargetFor } from './paths.ts';

export type GeneratedSourceComponent = GeneratedOutputComponent;

const sourceTarget = generatedTargetFor('source').path;

export function createGeneratedSourceEmitter(
  components: readonly GeneratedSourceComponent[],
): GeneratedOutputEmitter {
  return createComponentEmitter({
    components,
    emitterName: 'generated-source',
    noun: 'source',
    target: sourceTarget,
  });
}

export const generatedSourceEmitter: GeneratedOutputEmitter = createGeneratedSourceEmitter([
  heyApiSourceComponent,
  domainClientSourceComponent,
  operationRegistrySourceComponent,
]);
