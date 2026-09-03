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
  universe: () => [...PUBLIC_QUERY_KEYS.root, 'universe'] as const,
  universeTypes: () => [...PUBLIC_QUERY_KEYS.universe(), 'types'] as const,
  universeType: (typeId: number) => [...PUBLIC_QUERY_KEYS.universeTypes(), typeId] as const,
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
  characterAttributes: (characterId: number) =>
    [...PRIVATE_QUERY_KEYS.character(characterId), 'attributes'] as const,
  characterSkillQueue: (characterId: number) =>
    [...PRIVATE_QUERY_KEYS.character(characterId), 'skill-queue'] as const,
  characterSkills: (characterId: number) =>
    [...PRIVATE_QUERY_KEYS.character(characterId), 'skills'] as const,
  characterClones: (characterId: number) =>
    [...PRIVATE_QUERY_KEYS.character(characterId), 'clones'] as const,
  characterImplants: (characterId: number) =>
    [...PRIVATE_QUERY_KEYS.character(characterId), 'implants'] as const,
  characterHistory: (characterId: number) =>
    [...PRIVATE_QUERY_KEYS.character(characterId), 'history'] as const,
  characterFinance: (characterId: number) =>
    [...PRIVATE_QUERY_KEYS.character(characterId), 'finance'] as const,
  characterFinanceWallet: (characterId: number) =>
    [...PRIVATE_QUERY_KEYS.characterFinance(characterId), 'wallet'] as const,
  characterFinanceBalance: (characterId: number) =>
    [...PRIVATE_QUERY_KEYS.characterFinanceWallet(characterId), 'balance'] as const,
  characterFinanceJournal: (characterId: number, page: number) =>
    [...PRIVATE_QUERY_KEYS.characterFinanceWallet(characterId), 'journal', page] as const,
  characterFinanceTransactions: (characterId: number, fromId: number | null = null) =>
    [...PRIVATE_QUERY_KEYS.characterFinanceWallet(characterId), 'transactions', fromId] as const,
  characterFinanceMarket: (characterId: number) =>
    [...PRIVATE_QUERY_KEYS.characterFinance(characterId), 'market'] as const,
  characterFinanceOpenOrders: (characterId: number) =>
    [...PRIVATE_QUERY_KEYS.characterFinanceMarket(characterId), 'open-orders'] as const,
  characterFinanceOrderHistory: (characterId: number, page: number) =>
    [...PRIVATE_QUERY_KEYS.characterFinanceMarket(characterId), 'history', page] as const,
  characterFinanceContracts: (characterId: number) =>
    [...PRIVATE_QUERY_KEYS.characterFinance(characterId), 'contracts'] as const,
  characterFinanceContractPage: (characterId: number, page: number) =>
    [...PRIVATE_QUERY_KEYS.characterFinanceContracts(characterId), 'pages', page] as const,
  characterFinanceContract: (characterId: number, contractId: number) =>
    [...PRIVATE_QUERY_KEYS.characterFinanceContracts(characterId), 'detail', contractId] as const,
  characterFinanceContractItems: (characterId: number, contractId: number) =>
    [...PRIVATE_QUERY_KEYS.characterFinanceContract(characterId, contractId), 'items'] as const,
  characterFinanceContractBids: (characterId: number, contractId: number) =>
    [...PRIVATE_QUERY_KEYS.characterFinanceContract(characterId, contractId), 'bids'] as const,
  mail: (characterId: number) => [...PRIVATE_QUERY_KEYS.character(characterId), 'mail'] as const,
  mailHeaders: (
    characterId: number,
    labels: readonly number[] = [],
    lastMailId: number | null = null,
  ) =>
    [
      ...PRIVATE_QUERY_KEYS.mail(characterId),
      'headers',
      [...new Set(labels)].toSorted((left, right) => left - right),
      lastMailId,
    ] as const,
  mailDetail: (characterId: number, mailId: number) =>
    [...PRIVATE_QUERY_KEYS.mail(characterId), 'detail', mailId] as const,
  mailLabels: (characterId: number) => [...PRIVATE_QUERY_KEYS.mail(characterId), 'labels'] as const,
  mailingLists: (characterId: number) =>
    [...PRIVATE_QUERY_KEYS.mail(characterId), 'mailing-lists'] as const,
  mailRecipientResolution: (characterId: number, name: string) =>
    [...PRIVATE_QUERY_KEYS.mail(characterId), 'recipient-resolution', name] as const,
  mailRecipientSearch: (characterId: number, query: string) =>
    [...PRIVATE_QUERY_KEYS.mail(characterId), 'recipient-search', query] as const,
}

export const ADMIN_QUERY_KEYS = {
  root: ['admin'] as const,
  setup: ['admin', 'setup'] as const,
  session: ['admin', 'session'] as const,
} as const
