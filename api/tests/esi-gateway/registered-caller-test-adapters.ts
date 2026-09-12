type FeatureExecutionModule = typeof import('../../src/esi-gateway/feature-execution.js')

export interface CapturedEsiCallable {
  readonly execution: 'read' | 'mutation'
  execute(input: unknown): Promise<unknown>
}

export function captureRegisteredEsiCallables(
  featureExecution: FeatureExecutionModule,
  callables: Map<string, CapturedEsiCallable>,
): FeatureExecutionModule {
  return new Proxy(featureExecution, {
    get(target, property, receiver) {
      if (property === 'createPublicEsiRead' || property === 'createCharacterEsiRead')
        return captureFactory(Reflect.get(target, property, receiver), 'read', callables)
      if (property === 'createCharacterEsiMutation')
        return captureFactory(Reflect.get(target, property, receiver), 'mutation', callables)
      return Reflect.get(target, property, receiver)
    },
  })
}

function captureFactory(
  factory: unknown,
  execution: CapturedEsiCallable['execution'],
  callables: Map<string, CapturedEsiCallable>,
) {
  if (typeof factory !== 'function') throw new Error('Expected an ESI callable factory')
  return (definition: unknown) => {
    if (!hasStringProperty(definition, 'name')) throw new Error('Expected a named ESI definition')
    const callable: unknown = Reflect.apply(factory, undefined, [definition])
    if (!hasFunctionProperty(callable, 'execute'))
      throw new Error(`Expected ${definition.name} to create an ESI callable`)
    callables.set(definition.name, {
      execution,
      execute: (input) => Promise.resolve(Reflect.apply(callable.execute, callable, [input])),
    })
    return callable
  }
}

function hasStringProperty<Value extends string>(
  value: unknown,
  property: Value,
): value is Record<Value, string> {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, property) === 'string'
  )
}

function hasFunctionProperty<Value extends string>(
  value: unknown,
  property: Value,
): value is Record<Value, (...arguments_: unknown[]) => unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, property) === 'function'
  )
}
