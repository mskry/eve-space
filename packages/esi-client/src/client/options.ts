export type EsiLanguage = 'de' | 'en' | 'es' | 'fr' | 'ja' | 'ko' | 'ru' | 'zh';
export interface EsiTokenProviderContext {
  readonly signal?: AbortSignal;
}

export type EsiTokenProvider = (context?: EsiTokenProviderContext) => Promise<string>;
export type EsiFetch = typeof globalThis.fetch;

export interface EsiClientOptions {
  readonly baseUrl?: string;
  readonly compatibilityDate?: string;
  readonly language?: EsiLanguage;
  readonly requestTimeoutMs?: number;
  readonly token?: string;
  readonly tokenProvider?: EsiTokenProvider;
  readonly fetch?: EsiFetch;
  readonly validateResponses?: boolean;
  readonly validateRequests?: boolean;
  readonly allowGenericMutations?: boolean;
}

export interface SerializedEsiClientConfiguration {
  readonly baseUrl: string;
  readonly compatibilityDate: string;
  readonly language: EsiLanguage;
  readonly requestTimeoutMs: number;
  readonly validateResponses: boolean;
  readonly validateRequests: boolean;
  readonly allowGenericMutations: boolean;
}
