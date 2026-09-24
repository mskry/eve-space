import {
  definePlatformBoundedCollectionResource,
  definePlatformSingleRequestResource,
  type PlatformBoundedCollectionResourceImplementation,
  type PlatformResourceImplementationForContract,
  type PlatformResourceOperationContract,
  type PlatformSingleRequestResourceImplementation,
} from '@eve-space/platform-module-contract/resources'

interface RootInput {
  readonly path: { readonly character_id: number }
  readonly query?: { readonly page?: number }
}
interface RootOutput {
  readonly items: readonly number[]
}
interface DependentInput {
  readonly path: { readonly character_id: number }
  readonly body: number[]
}
type DependentOutput = readonly { readonly id: number; readonly name: string }[]

type RootProtocol = {
  readonly 'fixture-root': PlatformResourceOperationContract<RootInput, RootOutput>
}
type CollectionProtocol = RootProtocol & {
  readonly 'fixture-dependent': PlatformResourceOperationContract<DependentInput, DependentOutput>
}
type ExpectedCollectionProtocol = {
  readonly 'fixture-root': PlatformResourceOperationContract<RootInput, RootOutput>
  readonly 'fixture-dependent': PlatformResourceOperationContract<DependentInput, DependentOutput>
}

async function materialize() {}

const single = definePlatformSingleRequestResource<'fixture-root', RootProtocol, number>({
  map: ({ data }) => data.items.length,
  materialize,
  mode: 'single-request',
  operation: 'fixture-root',
  request: (subject) => ({ path: { character_id: subject.characterId } }),
})

const collection = definePlatformBoundedCollectionResource<
  'fixture-root',
  CollectionProtocol,
  number
>({
  async collect(context) {
    const root = await context.operations['fixture-root']({
      path: { character_id: context.subject.characterId },
      query: { page: 1 },
    })
    const names = await context.operations['fixture-dependent']({
      path: { character_id: context.subject.characterId },
      body: [...root.data.items],
    })
    return { complete: true, data: names.data.length }
  },
  materialize,
  mode: 'bounded-collection',
  operation: 'fixture-root',
})

void (single satisfies PlatformResourceImplementationForContract<
  typeof single,
  'fixture-root',
  RootProtocol,
  readonly [],
  object,
  object
>)

void (collection satisfies PlatformResourceImplementationForContract<
  typeof collection,
  'fixture-root',
  ExpectedCollectionProtocol,
  readonly [],
  object,
  object
>)

// @ts-expect-error a single-request resource cannot satisfy a declaration with dependent operations
void (single satisfies PlatformResourceImplementationForContract<
  typeof single,
  'fixture-root',
  ExpectedCollectionProtocol,
  readonly [],
  object,
  object
>)

// @ts-expect-error the implementation root operation must match the declaration
void (collection satisfies PlatformResourceImplementationForContract<
  typeof collection,
  'fixture-other-root',
  ExpectedCollectionProtocol & {
    readonly 'fixture-other-root': PlatformResourceOperationContract<RootInput, RootOutput>
  },
  readonly [],
  object,
  object
>)

// @ts-expect-error a collection protocol cannot omit a declared dependent operation
void (collection satisfies PlatformResourceImplementationForContract<
  typeof collection,
  'fixture-root',
  ExpectedCollectionProtocol & {
    readonly 'fixture-extra': PlatformResourceOperationContract<RootInput, RootOutput>
  },
  readonly [],
  object,
  object
>)

// @ts-expect-error a collection protocol cannot declare an operation absent from the declaration
void (collection satisfies PlatformResourceImplementationForContract<
  typeof collection,
  'fixture-root',
  RootProtocol,
  readonly [],
  object,
  object
>)

// @ts-expect-error matching aliases must also match every declared input contract
void (collection satisfies PlatformResourceImplementationForContract<
  typeof collection,
  'fixture-root',
  {
    readonly 'fixture-root': PlatformResourceOperationContract<RootInput, RootOutput>
    readonly 'fixture-dependent': PlatformResourceOperationContract<
      { readonly path: { readonly character_id: string }; readonly body: number[] },
      DependentOutput
    >
  },
  readonly [],
  object,
  object
>)

// @ts-expect-error matching aliases must also match every declared output contract
void (collection satisfies PlatformResourceImplementationForContract<
  typeof collection,
  'fixture-root',
  {
    readonly 'fixture-root': PlatformResourceOperationContract<RootInput, unknown>
    readonly 'fixture-dependent': PlatformResourceOperationContract<DependentInput, DependentOutput>
  },
  readonly [],
  object,
  object
>)

type LooseProtocol = {
  readonly 'fixture-root': PlatformResourceOperationContract<any, any>
}
declare const loose: PlatformSingleRequestResourceImplementation<
  'fixture-root',
  LooseProtocol,
  number
>

// @ts-expect-error an erased any contract cannot stand in for a reviewed operation contract
void (loose satisfies PlatformResourceImplementationForContract<
  typeof loose,
  'fixture-root',
  RootProtocol,
  readonly [],
  object,
  object
>)

const crossModeSingle: PlatformSingleRequestResourceImplementation<'fixture-root', RootProtocol> = {
  mode: 'single-request',
  operation: 'fixture-root',
  request: (subject) => ({ path: { character_id: subject.characterId } }),
  map: () => undefined,
  // @ts-expect-error single-request resources cannot provide collection execution
  collect: async () => ({ complete: true, data: undefined }),
  materialize,
}

const collectionMethods = {
  collect: async () => ({ complete: true, data: undefined }),
  materialize,
  mode: 'bounded-collection',
  operation: 'fixture-root',
  request: () => ({ path: { character_id: 1 } }),
} as const
// @ts-expect-error bounded collections cannot retain unreachable single-request methods
const crossModeCollection: PlatformBoundedCollectionResourceImplementation<
  'fixture-root',
  RootProtocol
> = collectionMethods

// @ts-expect-error every implementation must declare its execution mode
const missingMode: PlatformBoundedCollectionResourceImplementation<'fixture-root', RootProtocol> = {
  collect: async () => ({ complete: true, data: undefined }),
  materialize,
  operation: 'fixture-root',
}

declare const missingRoot: PlatformBoundedCollectionResourceImplementation<
  'fixture-root',
  // @ts-expect-error a collection protocol must contain its root operation
  {
    readonly 'fixture-dependent': PlatformResourceOperationContract<DependentInput, DependentOutput>
  }
>

definePlatformBoundedCollectionResource<'fixture-root', RootProtocol, number>({
  async collect(context) {
    // @ts-expect-error undeclared operations have no callable member
    await context.operations['fixture-dependent']({ path: { character_id: 1 }, body: [] })
    // @ts-expect-error operation inputs must match the declared contract
    await context.operations['fixture-root']({ path: { character_id: 'one' } })
    const result = await context.operations['fixture-root']({ path: { character_id: 1 } })
    // @ts-expect-error operation outputs retain their declared contract
    const invalid: string = result.data.items
    void invalid
    // @ts-expect-error collection contexts expose no arbitrary operation dispatcher
    await context.execute('fixture-root', {})
    return { complete: true, data: result.data.items.length }
  },
  materialize,
  mode: 'bounded-collection',
  operation: 'fixture-root',
})

void [crossModeSingle, crossModeCollection, missingMode, missingRoot]
