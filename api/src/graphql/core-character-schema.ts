import { GraphQLError } from 'graphql'
import { CharacterSelectionInputError } from '../auth/character-selection.js'
import { safeGraphQLError } from './errors.js'
import { AssetCursorRestartError } from '../characters/asset-cursor.js'
import { CharacterAssetsPaginationError, characterAssetsScope } from '../characters/asset-pages.js'
import type { createCoreCharacterReads } from './core-character-reads.js'

export { coreCharacterTypeDefs } from './core-character-types.js'

export interface CoreCharacterContext {
  readonly characters: ReturnType<typeof createCoreCharacterReads>
}

type OwnedSubject = Awaited<ReturnType<CoreCharacterContext['characters']['ownedCharacter']>>
interface PageArguments {
  first: number
  after?: string | null
}

const resolveRead = async <Result>(
  load: () => Promise<Result>,
  characterId?: string,
  requiredScope?: string,
): Promise<Result> => {
  try {
    return await load()
  } catch (error) {
    if (error instanceof AssetCursorRestartError)
      throw new GraphQLError(error.message, {
        extensions: { code: 'ASSET_CURSOR_RESTART', status: 409 },
      })
    if (error instanceof CharacterSelectionInputError)
      throw new GraphQLError(error.message, { extensions: { code: 'BAD_USER_INPUT', status: 400 } })
    if (error instanceof CharacterAssetsPaginationError)
      throw new GraphQLError('EVE Online returned invalid asset pagination metadata.', {
        extensions: { code: 'ESI_RESPONSE_INVALID', status: 502 },
      })
    throw safeGraphQLError(error, characterId, requiredScope)
  }
}

export const coreCharacterResolvers = {
  Query: {
    ownedCharacters: (
      _parent: Readonly<Record<string, never>>,
      { first, after }: PageArguments,
      context: CoreCharacterContext,
    ) => resolveRead(() => context.characters.ownedCharacters(first, after ?? null)),
    ownedCharacter: (
      _parent: Readonly<Record<string, never>>,
      { characterId }: { characterId: string },
      context: CoreCharacterContext,
    ) => resolveRead(() => context.characters.ownedCharacter(characterId), characterId),
  },
  OwnedCharacter: {
    assets: (parent: OwnedSubject, { first, after }: PageArguments) =>
      resolveRead(
        () => parent.assets(first, after ?? null),
        String(parent.characterId),
        characterAssetsScope,
      ),
  },
}
