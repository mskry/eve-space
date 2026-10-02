import { immediateReadWork, type ReadAdmissionWork } from '../auth/read-work.js'
import type { PlatformPersistenceOperationInvoker } from '@eve-space/platform-module-server'

export interface ReadCapabilityGuard {
  assertCurrent(work?: ReadAdmissionWork): Promise<void>
}

type ReadCapabilityMethod = (...input: never[]) => ReturnType<PlatformPersistenceOperationInvoker>
type ReadCapabilityMethods = Readonly<Record<string, ReadCapabilityMethod>>

export const guardReadCapabilities = <Capabilities extends ReadCapabilityMethods>(
  capabilities: Capabilities,
  guard: ReadCapabilityGuard,
  work?: ReadAdmissionWork,
): Capabilities => {
  const guarded = Object.fromEntries(
    Object.entries(capabilities).map(([name, method]) => [
      name,
      async (...args: never[]) => {
        await guard.assertCurrent()
        const load = async (slot: ReadAdmissionWork = immediateReadWork) => {
          await guard.assertCurrent(slot)
          return method(...args)
        }
        const result = work ? await work.run(load) : await method(...args)
        await guard.assertCurrent()
        return result
      },
    ]),
  )
  // SAFETY: Every named async method retains its input and result; wrappers add only admission checks.
  return Object.freeze(guarded) as Capabilities
}
