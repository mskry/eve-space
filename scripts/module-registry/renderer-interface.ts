import type { CompiledPlatformModules } from '@eve-space/platform-module-contract/compiler'

export type PlatformRegistryRenderer = (
  compiled: CompiledPlatformModules,
) => ReadonlyMap<string, string>
