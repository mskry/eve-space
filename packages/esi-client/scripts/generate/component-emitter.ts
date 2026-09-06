import { lstat, mkdir } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';

import type { EmitterContext, GeneratedOutputEmitter } from './generation-contracts.ts';
import { normalizeGeneratedPath } from './paths.ts';

export interface GeneratedOutputComponent {
  readonly name: string;
  emit(context: EmitterContext, directory: string): Promise<readonly string[]>;
}

export interface ComponentEmitterOptions<TComponent extends GeneratedOutputComponent> {
  /** Emitter name reported in orchestration claims. */
  readonly emitterName: string;
  /** Generated replacement target this emitter owns. */
  readonly target: string;
  /** Noun used in diagnostics, e.g. `source`, `test`, `example`. */
  readonly noun: string;
  readonly components: readonly TComponent[];
  /** Optional per-file step applied after a component writes it, such as formatting. */
  readonly postProcess?: (this: void, outputPath: string, relativePath: string) => Promise<void>;
}

/**
 * Builds a directory-target emitter that runs an ordered component list and verifies every
 * declared output is a distinct regular file inside the target.
 */
export function createComponentEmitter<TComponent extends GeneratedOutputComponent>(
  options: ComponentEmitterOptions<TComponent>,
): GeneratedOutputEmitter {
  const { components, emitterName, noun, target, postProcess } = options;
  if (!Array.isArray(components) || components.length === 0) {
    throw new TypeError(`Generated ${noun} components must be a non-empty array`);
  }
  const ordered = [...components];
  const names = new Set<string>();
  for (const component of ordered) {
    if (
      component === null ||
      typeof component !== 'object' ||
      typeof component.name !== 'string' ||
      component.name.length === 0 ||
      typeof component.emit !== 'function'
    ) {
      throw new TypeError(`Invalid generated ${noun} component`);
    }
    if (names.has(component.name)) {
      throw new Error(`Duplicate generated ${noun} component name: ${component.name}`);
    }
    names.add(component.name);
  }

  return Object.freeze({
    name: emitterName,
    async emit(context: EmitterContext) {
      const directory = context.outputPath(target);
      await mkdir(directory, { recursive: true });
      const outputs = new Set<string>();
      for (const component of ordered) {
        const componentOutputs = await component.emit(context, directory);
        if (!Array.isArray(componentOutputs)) {
          throw new TypeError(
            `Generated ${noun} component ${component.name} did not return output paths`,
          );
        }
        for (const output of componentOutputs) {
          const relativePath = validateRelativeOutputPath(output, component.name, noun);
          if (outputs.has(relativePath)) {
            throw new Error(`Duplicate generated ${noun} output: ${relativePath}`);
          }
          outputs.add(relativePath);
          const outputPath = join(directory, relativePath);
          const status = await lstat(outputPath);
          if (!status.isFile() || status.isSymbolicLink()) {
            throw new Error(`Generated ${noun} output must be a regular file: ${relativePath}`);
          }
          await postProcess?.(outputPath, relativePath);
        }
      }
      return [{ target, kind: 'directory' as const }];
    },
  });
}

function validateRelativeOutputPath(path: string, componentName: string, noun: string): string {
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path)) {
    throw new Error(`Generated ${noun} component ${componentName} returned an invalid output path`);
  }
  const normalized = normalizeGeneratedPath(normalize(path));
  if (normalized === '..' || normalized.startsWith('../') || normalized === '.') {
    throw new Error(`Generated ${noun} component ${componentName} returned an unsafe output path`);
  }
  return normalized;
}
