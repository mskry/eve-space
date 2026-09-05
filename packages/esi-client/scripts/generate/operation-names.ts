export function operationSchemaName(operationId: string): string {
  const words = operationId
    .replaceAll(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .split(/[^A-Za-z0-9]+/u)
    .filter(Boolean);
  let identifier = words
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join('');
  if (identifier === '') identifier = 'Operation';
  if (!/^[A-Za-z_$]/u.test(identifier)) identifier = `Operation${identifier}`;
  return identifier;
}
