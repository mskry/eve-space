import type { CompiledPlatformModules } from '@eve-space/platform-module-contract/compiler'
import type { PlatformModuleManifest } from '@eve-space/platform-module-contract/manifest'
import type { PlatformRegistryRenderer } from '../../../scripts/module-registry/renderer-interface.js'

declare const compiled: CompiledPlatformModules
declare const raw: readonly PlatformModuleManifest[]
declare const renderRegistry: PlatformRegistryRenderer

renderRegistry(compiled)

// @ts-expect-error Registry rendering accepts only compiled module state.
renderRegistry(raw)
