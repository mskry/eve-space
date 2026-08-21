import {
  reduceApiQueryError,
  reduceNativeError,
  reviveApiQueryError,
  reviveNativeError,
} from '../utils/query-error'

export default definePayloadPlugin(() => {
  definePayloadReducer('ApiQueryError', reduceApiQueryError)
  definePayloadReviver('ApiQueryError', reviveApiQueryError)
  definePayloadReducer('QueryNativeError', reduceNativeError)
  definePayloadReviver('QueryNativeError', reviveNativeError)
})
