import {
  hasControlCharacter,
  hasUnpairedSurrogate,
  isHttpMethod,
  isRecord,
  placeholderPattern,
} from './guards.js';
import { validateParameter } from './parameter-validation.js';
import type {
  JsonRequestBodyDescriptor,
  ValidatedDescriptor,
  ValidatedParameter,
} from './types.js';

export function validateDescriptor(value: unknown): ValidatedDescriptor {
  if (!isRecord(value)) throw new TypeError('Operation descriptor must be an object');
  const operationId = value.operationId;
  if (
    typeof operationId !== 'string' ||
    operationId.length === 0 ||
    operationId !== operationId.trim() ||
    hasControlCharacter(operationId) ||
    hasUnpairedSurrogate(operationId)
  ) {
    throw new TypeError('Operation descriptor operationId must be a non-empty safe string');
  }
  const method = value.method;
  if (!isHttpMethod(method)) {
    throw new TypeError(`Invalid HTTP method in operation descriptor ${operationId}`);
  }
  const path = value.path;
  if (typeof path !== 'string') {
    throw new TypeError(`Invalid path template in operation descriptor ${operationId}`);
  }
  validatePathTemplate(path, operationId);
  if (!Array.isArray(value.parameters)) {
    throw new TypeError(`Operation descriptor ${operationId} parameters must be an array`);
  }
  const parameters = value.parameters.map((parameter, index) =>
    validateParameter(parameter, operationId, index),
  );
  validateParameterIdentities(parameters, operationId);
  validatePathParameters(path, parameters, operationId);
  const requestBody = validateRequestBody(value.requestBody, operationId);
  if (value.requestSchema !== undefined) {
    if (!isRecord(value.requestSchema) || typeof value.requestSchema.safeParse !== 'function') {
      throw new TypeError(
        `Operation descriptor ${operationId} requestSchema must provide safeParse()`,
      );
    }
  }
  if (
    requestBody !== null &&
    parameters.some(
      ({ placement, name }) => placement === 'header' && name.toLowerCase() === 'content-type',
    )
  ) {
    throw new TypeError(
      `Operation descriptor ${operationId} must not declare Content-Type as a parameter`,
    );
  }
  return {
    operationId,
    method,
    path,
    parameters,
    requestBody,
  };
}

function validatePathTemplate(path: string, operationId: string): void {
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('?') ||
    path.includes('#') ||
    path.includes('\\') ||
    path.includes('%') ||
    hasControlCharacter(path) ||
    hasUnpairedSurrogate(path) ||
    /\s/u.test(path)
  ) {
    throw new TypeError(`Invalid path template in operation descriptor ${operationId}`);
  }
  const withoutPlaceholders = path.replace(placeholderPattern, 'parameter');
  if (withoutPlaceholders.includes('{') || withoutPlaceholders.includes('}')) {
    throw new TypeError(`Malformed path placeholder in operation descriptor ${operationId}`);
  }
  if (withoutPlaceholders.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new TypeError(`Unsafe static path segment in operation descriptor ${operationId}`);
  }
}

function validateParameterIdentities(
  parameters: readonly ValidatedParameter[],
  operationId: string,
): void {
  const identities = new Set<string>();
  const headerNames = new Set<string>();
  for (const parameter of parameters) {
    const identity = `${parameter.placement}:${parameter.name}`;
    if (identities.has(identity)) {
      throw new TypeError(`Duplicate parameter ${identity} in operation descriptor ${operationId}`);
    }
    identities.add(identity);
    if (parameter.placement !== 'header') continue;
    const lowerName = parameter.name.toLowerCase();
    if (headerNames.has(lowerName)) {
      throw new TypeError(
        `Duplicate case-insensitive header ${parameter.name} in operation descriptor ${operationId}`,
      );
    }
    headerNames.add(lowerName);
  }
}

function validatePathParameters(
  path: string,
  parameters: readonly ValidatedParameter[],
  operationId: string,
): void {
  const placeholders = [...path.matchAll(placeholderPattern)].map((match) => match[1]);
  const pathParameters = parameters.filter(({ placement }) => placement === 'path');
  if (placeholders.some((placeholder) => placeholder.includes('/'))) {
    throw new TypeError(`Malformed path placeholder in operation descriptor ${operationId}`);
  }
  const placeholderSet = new Set(placeholders);
  if (placeholderSet.size !== placeholders.length) {
    throw new TypeError(`Duplicate path placeholder in operation descriptor ${operationId}`);
  }
  for (const placeholder of placeholders) {
    if (!pathParameters.some(({ name }) => name === placeholder)) {
      throw new TypeError(
        `Undeclared path placeholder ${placeholder} in operation descriptor ${operationId}`,
      );
    }
  }
  for (const parameter of pathParameters) {
    if (!parameter.required) {
      throw new TypeError(`Path parameter ${operationId}:${parameter.name} must be required`);
    }
    if (!placeholderSet.has(parameter.name)) {
      throw new TypeError(
        `Path parameter ${operationId}:${parameter.name} has no matching placeholder`,
      );
    }
  }
}

function validateRequestBody(
  value: unknown,
  operationId: string,
): JsonRequestBodyDescriptor | null {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.required !== 'boolean') {
    throw new TypeError(`Invalid request body descriptor for operation ${operationId}`);
  }
  if (value.mediaType !== 'application/json') {
    throw new TypeError(
      `Unsupported request body media type ${String(value.mediaType)} for operation ${operationId}`,
    );
  }
  return { required: value.required, mediaType: 'application/json' };
}
