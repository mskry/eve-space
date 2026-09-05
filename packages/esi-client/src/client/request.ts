import { validateDescriptor } from './request/descriptor-validation.js';
import { collectParameterValues, validateArgumentsObject } from './request/argument-validation.js';
import { serializeBody } from './request/json-body.js';
import { createHeaderRecord, serializeQuery, substitutePath } from './request/serialization.js';
import type {
  ConstructedOperationRequest,
  ExecutableOperationDescriptor,
  OperationHttpMethod,
  OperationRequestArguments,
} from './request/types.js';

export type {
  ArrayParameterSchema,
  BooleanParameterSchema,
  ConstructedOperationRequest,
  ExecutableOperationDescriptor,
  HeaderOperationParameterDescriptor,
  IntegerParameterSchema,
  JsonObject,
  JsonPrimitive,
  JsonRequestBodyDescriptor,
  JsonValue,
  NumberParameterSchema,
  OperationHttpMethod,
  OperationParameterDescriptor,
  OperationParameterPlacement,
  OperationArguments,
  OperationParameterSchema,
  OperationRequestArguments,
  OperationSchema,
  OperationSchemaIssue,
  OperationSchemaResult,
  PathOperationParameterDescriptor,
  QueryOperationParameterDescriptor,
  ScalarParameterSchema,
  StringParameterSchema,
} from './request/types.js';

export function constructOperationRequest<
  TArguments extends OperationRequestArguments = OperationRequestArguments,
>(
  descriptor: ExecutableOperationDescriptor<TArguments>,
  arguments_: TArguments,
): ConstructedOperationRequest {
  const validated = validateDescriptor(descriptor);
  const argumentObject = validateArgumentsObject(validated, arguments_);
  const valuesByPlacement = collectParameterValues(validated, argumentObject);
  const path = substitutePath(validated, valuesByPlacement.path);
  const query = serializeQuery(validated, valuesByPlacement.query);
  const headers = createHeaderRecord(validated, valuesByPlacement.header);
  const body = serializeBody(validated, argumentObject, headers);
  const requestPath = query.length === 0 ? path : `${path}?${query}`;
  const request: {
    method: OperationHttpMethod;
    path: string;
    headers: Readonly<Record<string, string>>;
    body?: string;
  } = {
    method: validated.method,
    path: requestPath,
    headers: Object.freeze(headers),
  };
  if (body !== undefined) request.body = body;
  return Object.freeze(request);
}
