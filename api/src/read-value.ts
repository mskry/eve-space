import { createHash } from 'node:crypto'
import { serialize } from 'node:v8'

export const encodeReadValue = <Value>(value: Value) => serialize(value)

export const fingerprintReadValue = <Value>(value: Value) =>
  createHash('sha256').update(encodeReadValue(value)).digest('hex')
