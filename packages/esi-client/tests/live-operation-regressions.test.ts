import { describe, expect, test, vi } from 'vitest';

import { EsiHttpError, EsiResponseValidationError } from '../src/client/errors.js';
import { createUniverseClient } from '../src/generated/domains/universe.js';

const getUniverseBloodlinesNullableShipTypeIdFixture = [
  {
    bloodline_id: 5,
    charisma: 3,
    corporation_id: 1_000_166,
    description: 'Observed live bloodline response',
    intelligence: 7,
    memory: 4,
    name: 'Khanid',
    perception: 8,
    race_id: 4,
    ship_type_id: null,
    willpower: 7,
  },
] as const;

const postUniverseNamesCharacter90666561Fixture = {
  ids: [90_666_561],
  error: { error: 'Ensure all IDs are valid before resolving' },
} as const;

describe('live ESI operation regressions', () => {
  test('GetUniverseBloodlines rejects nullable live ship_type_id while SDK validation remains enabled by default', async () => {
    const fetch = jsonFetch(getUniverseBloodlinesNullableShipTypeIdFixture);

    const result = createUniverseClient({ fetch }).listBloodlines();

    await expect(result).rejects.toBeInstanceOf(EsiResponseValidationError);
    await expect(result).rejects.toMatchObject({
      code: 'ESI_RESPONSE_VALIDATION_ERROR',
      operationId: 'GetUniverseBloodlines',
      issues: [expect.objectContaining({ path: [0, 'ship_type_id'] })],
    });
  });

  test('GetUniverseBloodlines permits the API operation-specific validation override', async () => {
    const fetch = jsonFetch(getUniverseBloodlinesNullableShipTypeIdFixture);

    const result = await createUniverseClient({ fetch, validateResponses: false }).listBloodlines();

    expect(result).toEqual(getUniverseBloodlinesNullableShipTypeIdFixture);
  });

  test('PostUniverseNames preserves the structured 90666561 live 404 error', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(postUniverseNamesCharacter90666561Fixture.error, { status: 404 }),
    );
    const client = createUniverseClient({ fetch });

    const error = await client
      .resolveNames({ body: [...postUniverseNamesCharacter90666561Fixture.ids] })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EsiHttpError);
    expect(error).toMatchObject({
      code: 'ESI_HTTP_ERROR',
      operationId: 'PostUniverseNames',
      status: 404,
      bodyFormat: 'json',
      body: postUniverseNamesCharacter90666561Fixture.error,
      bodyTruncated: false,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
});

function jsonFetch(value: unknown) {
  return vi.fn<typeof globalThis.fetch>(async () => Response.json(value));
}
