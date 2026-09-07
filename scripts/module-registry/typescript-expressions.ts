import ts from 'typescript'

export function unwrapExpression(expression: ts.Expression): ts.Expression {
  let value = expression
  while (
    ts.isParenthesizedExpression(value) ||
    ts.isAsExpression(value) ||
    ts.isTypeAssertionExpression(value) ||
    ts.isNonNullExpression(value) ||
    ts.isSatisfiesExpression(value)
  )
    value = value.expression
  return value
}
