export const createDeferred = <Value>() => {
  let fail: (reason?: Error) => void
  let complete: (value: Value) => void
  const promise = new Promise<Value>((resolve, reject) => {
    complete = resolve
    fail = reject
  })
  return {
    promise,
    resolve: (value: Value) => complete(value),
    reject: (reason?: Error) => fail(reason),
  }
}
