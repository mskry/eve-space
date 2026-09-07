import { zValidator as honoZodValidator } from '@hono/zod-validator'
import type { Env, Input, MiddlewareHandler, ValidationTargets } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { InferInput } from 'hono/validator'
import type { input, output, ZodType } from 'zod'

type HasUndefined<T> = undefined extends T ? true : false
type DefaultInput<Target extends keyof ValidationTargets, In, Out> = {
  in: HasUndefined<In> extends true
    ? { [Key in Target]?: [In] extends [ValidationTargets[Key]] ? In : InferInput<In, Key> }
    : { [Key in Target]: [In] extends [ValidationTargets[Key]] ? In : InferInput<In, Key> }
  out: { [Key in Target]: Out }
}
type CanonicalZValidator = <
  Schema extends ZodType,
  Target extends keyof ValidationTargets,
  Environment extends Env,
  Path extends string,
  In = input<Schema>,
  Out = output<Schema>,
  ValidatorInput extends Input = DefaultInput<Target, In, Out>,
  ValidatedInput extends ValidatorInput = ValidatorInput,
>(
  target: Target,
  schema: Schema,
) => MiddlewareHandler<Environment, Path, ValidatedInput, never>

export const zValidator = ((target: keyof ValidationTargets, schema: ZodType) =>
  honoZodValidator(target, schema, (result) => {
    if (!result.success) {
      throw new HTTPException(400, {
        message: result.error.issues[0]?.message ?? 'Invalid request.',
      })
    }
  })) as CanonicalZValidator
