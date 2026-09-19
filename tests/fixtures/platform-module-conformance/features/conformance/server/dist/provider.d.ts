import type { PlatformActivityProvider, PlatformActivityProviderCapabilities } from '@eve-space/platform-module-contract/activity';
import type { ConformanceSnapshotReadPersistence } from './persistence.js';
type ConformanceActivityProviderCapabilities = PlatformActivityProviderCapabilities<ConformanceSnapshotReadPersistence>;
export declare function conformanceActivityProvider(capabilities: ConformanceActivityProviderCapabilities): PlatformActivityProvider;
export {};
