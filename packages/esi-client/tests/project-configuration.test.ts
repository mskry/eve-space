import { describe, expect, it } from 'vitest';

import { zCorporationsProjectsDetail } from '../src/generated/zod.gen.js';

const configuration = zCorporationsProjectsDetail.shape.configuration;

describe('corporation project configuration', () => {
  it.each([
    { manual: {} },
    { earn_loyalty_point: { corporations: [{ corporation_id: 98_000_001 }] } },
    { unknown: { data: { target: 42 }, type: 'future-project' } },
  ])('accepts a single declared variant: %j', (value) => {
    expect(configuration.parse(value)).toStrictEqual(value);
  });

  it.each([
    {},
    { earn_loyalty_point: {}, manual: {} },
    { manual: null },
    { earn_loyalty_point: { corporations: [{ corporation_id: 'invalid' }] } },
    { unknown: { data: {} } },
  ])('rejects missing, ambiguous, or malformed variants: %j', (value) => {
    expect(() => configuration.parse(value)).toThrow(/Invalid input/);
  });
});
