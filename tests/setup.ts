import { afterAll, afterEach, beforeAll } from 'vitest'
import { queryServer } from './support/query-server'

beforeAll(() => queryServer.listen({ onUnhandledRequest: 'error' }))
afterEach(() => queryServer.resetHandlers())
afterAll(() => queryServer.close())
