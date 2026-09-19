import type { PlatformActivityProvider } from '@eve-space/platform-module-contract/activity'
import type { PlatformModuleRouteCapabilities } from '@eve-space/platform-module-contract/server'
import type { Hono } from 'hono'
export declare const readFixtureOperation: object
export declare function fixtureRoutes(capabilities: PlatformModuleRouteCapabilities): Hono
export declare function fixtureProvider(): PlatformActivityProvider
