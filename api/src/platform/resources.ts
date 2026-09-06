import type { PlatformInstalledResourceDescriptor } from '@eve-space/platform-module-contract'
import { installedModuleResources } from '../generated/platform/installed-module-worker.js'
import { coreResources } from './core-resources.js'

export const platformResources = [
  ...coreResources,
  ...installedModuleResources,
] as readonly PlatformInstalledResourceDescriptor[]
