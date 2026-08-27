export const PUBLIC_QUERY_KEYS = {
  root: ['public'] as const,
  systemStatus: () => [...PUBLIC_QUERY_KEYS.root, 'system-status'] as const,
  characters: () => [...PUBLIC_QUERY_KEYS.root, 'characters'] as const,
  character: (characterId: number) => [...PUBLIC_QUERY_KEYS.characters(), characterId] as const,
  corporations: () => [...PUBLIC_QUERY_KEYS.root, 'corporations'] as const,
  corporation: (corporationId: number) =>
    [...PUBLIC_QUERY_KEYS.corporations(), corporationId] as const,
  corporationAllianceHistory: (corporationId: number) =>
    [...PUBLIC_QUERY_KEYS.corporation(corporationId), 'alliance-history'] as const,
}

export const AUTH_QUERY_KEYS = {
  root: ['auth'] as const,
  config: () => [...AUTH_QUERY_KEYS.root, 'config'] as const,
}

export const PRIVATE_QUERY_KEYS = {
  root: ['private'] as const,
  session: () => [...PRIVATE_QUERY_KEYS.root, 'session'] as const,
  characters: () => [...PRIVATE_QUERY_KEYS.root, 'characters'] as const,
  roster: () => [...PRIVATE_QUERY_KEYS.characters(), 'roster'] as const,
  character: (characterId: number) => [...PRIVATE_QUERY_KEYS.characters(), characterId] as const,
  characterModules: (characterId: number) =>
    [...PRIVATE_QUERY_KEYS.character(characterId), 'modules'] as const,
  characterModule: (characterId: number, moduleId: string) =>
    [...PRIVATE_QUERY_KEYS.characterModules(characterId), moduleId] as const,
  characterModuleResource: (characterId: number, moduleId: string, resourceId: string) =>
    [...PRIVATE_QUERY_KEYS.characterModule(characterId, moduleId), resourceId] as const,
  characterOverview: (characterId: number) =>
    [...PRIVATE_QUERY_KEYS.character(characterId), 'overview'] as const,
  characterSkills: (characterId: number) =>
    [...PRIVATE_QUERY_KEYS.character(characterId), 'skills'] as const,
  characterHistory: (characterId: number) =>
    [...PRIVATE_QUERY_KEYS.character(characterId), 'history'] as const,
  wallet: (characterId: number) =>
    [...PRIVATE_QUERY_KEYS.character(characterId), 'wallet'] as const,
  walletTransactions: (characterId: number) =>
    [...PRIVATE_QUERY_KEYS.wallet(characterId), 'transactions'] as const,
}

export const ADMIN_QUERY_KEYS = {
  root: ['admin'] as const,
  setup: ['admin', 'setup'] as const,
  session: ['admin', 'session'] as const,
} as const
