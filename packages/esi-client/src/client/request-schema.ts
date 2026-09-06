import { z } from 'zod';

import type { OperationRequestArguments } from './request.js';

export interface OperationRequestObjectSchemaLayer {
  readonly required: boolean;
  readonly schema: z.ZodObject;
}

export interface OperationRequestSchemaLayer {
  readonly required: boolean;
  readonly schema: z.ZodType;
}

export interface OperationRequestSchemaLayers {
  readonly body?: OperationRequestSchemaLayer;
  readonly headers?: OperationRequestObjectSchemaLayer;
  readonly path?: OperationRequestObjectSchemaLayer;
  readonly query?: OperationRequestObjectSchemaLayer;
}

export function composeOperationRequestSchema<TArguments extends OperationRequestArguments>(
  layers: OperationRequestSchemaLayers,
): z.ZodType<TArguments> {
  const shape: Record<string, z.ZodType> = {};
  for (const name of ['headers', 'path', 'query'] as const) {
    const layer = layers[name];
    if (layer !== undefined) {
      const schema = layer.schema.strict();
      shape[name] = layer.required ? requiredInput(schema) : optionalInput(schema);
    }
  }
  if (layers.body !== undefined) {
    shape.body = layers.body.required
      ? requiredInput(layers.body.schema)
      : optionalInput(layers.body.schema);
  }

  // The generated descriptor supplies TArguments from the same natural schemas and requiredness.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return z.strictObject(shape) as unknown as z.ZodType<TArguments>;
}

function requiredInput(schema: z.ZodType): z.ZodType {
  return preserveInput(schema);
}

function optionalInput(schema: z.ZodType): z.ZodType {
  return preserveInput(schema).optional();
}

function preserveInput(schema: z.ZodType): z.ZodType {
  return z.unknown().superRefine((value, context) => {
    const result = schema.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) context.addIssue({ ...issue });
    }
  });
}
