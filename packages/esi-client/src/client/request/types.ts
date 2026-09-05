export type OperationHttpMethod =
  | 'DELETE'
  | 'GET'
  | 'HEAD'
  | 'OPTIONS'
  | 'PATCH'
  | 'POST'
  | 'PUT'
  | 'TRACE';
export type OperationParameterPlacement = 'path' | 'query' | 'header';
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface StringParameterSchema {
  readonly type: 'string';
}

export interface BooleanParameterSchema {
  readonly type: 'boolean';
}

export interface IntegerParameterSchema {
  readonly type: 'integer';
}

export interface NumberParameterSchema {
  readonly type: 'number';
}

export type ScalarParameterSchema =
  | StringParameterSchema
  | BooleanParameterSchema
  | IntegerParameterSchema
  | NumberParameterSchema;

export interface ArrayParameterSchema {
  readonly type: 'array';
  readonly items: ScalarParameterSchema;
}

export type OperationParameterSchema = ScalarParameterSchema | ArrayParameterSchema;

interface OperationParameterDescriptorBase {
  readonly name: string;
  readonly required: boolean;
  readonly schema: OperationParameterSchema;
}

export interface PathOperationParameterDescriptor extends OperationParameterDescriptorBase {
  readonly placement: 'path';
  readonly style?: 'simple' | null;
  readonly explode?: boolean | null;
}

export interface QueryOperationParameterDescriptor extends OperationParameterDescriptorBase {
  readonly placement: 'query';
  readonly style?: 'form' | null;
  readonly explode?: boolean | null;
  readonly allowReserved?: false | null;
}

export interface HeaderOperationParameterDescriptor extends OperationParameterDescriptorBase {
  readonly placement: 'header';
  readonly style?: 'simple' | null;
  readonly explode?: boolean | null;
}

export type OperationParameterDescriptor =
  | PathOperationParameterDescriptor
  | QueryOperationParameterDescriptor
  | HeaderOperationParameterDescriptor;

export interface JsonRequestBodyDescriptor {
  readonly required: boolean;
  readonly mediaType: 'application/json';
}

export interface OperationSchemaIssue {
  readonly path?: readonly PropertyKey[];
  readonly message?: string;
  readonly code?: string;
}

export type OperationSchemaResult<T> =
  | { readonly success: true; readonly data: T }
  | {
      readonly success: false;
      readonly error: { readonly issues: readonly OperationSchemaIssue[] };
    };

export interface OperationSchema<T = unknown> {
  readonly safeParse: (value: unknown) => OperationSchemaResult<T>;
}

export interface OperationRequestArguments {
  readonly path?: Readonly<Record<string, unknown>>;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly headers?: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
}

export type OperationArguments<TData> = Omit<TData, 'url'>;

export interface ExecutableOperationDescriptor<
  TArguments extends OperationRequestArguments = OperationRequestArguments,
> {
  readonly operationId: string;
  readonly method: OperationHttpMethod;
  readonly path: string;
  readonly parameters: readonly OperationParameterDescriptor[];
  readonly requestBody: JsonRequestBodyDescriptor | null;
  readonly requestSchema?: OperationSchema<TArguments>;
}

export interface ConstructedOperationRequest {
  readonly method: OperationHttpMethod;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface ValidatedParameter {
  readonly name: string;
  readonly placement: OperationParameterPlacement;
  readonly required: boolean;
  readonly schema: OperationParameterSchema;
  readonly explode: boolean;
}

export interface ValidatedDescriptor {
  readonly operationId: string;
  readonly method: OperationHttpMethod;
  readonly path: string;
  readonly parameters: readonly ValidatedParameter[];
  readonly requestBody: JsonRequestBodyDescriptor | null;
}
