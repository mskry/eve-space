const abortedDescriptor = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted');

export function isAbortSignal(value: unknown): value is AbortSignal {
  if (typeof value !== 'object' || value === null || typeof abortedDescriptor?.get !== 'function')
    return false;
  try {
    // oxlint-disable-next-line typescript/unbound-method -- Reflect.apply supplies the candidate receiver for the native brand check
    Reflect.apply(abortedDescriptor.get, value, []);
    return true;
  } catch {
    return false;
  }
}
