import { describe, expect, it } from 'vitest';

import { zCorporationsProjectsDetail } from '../src/generated/zod.gen.js';

const configuration = zCorporationsProjectsDetail.shape.configuration;

describe('corporation project configuration', () => {
  it.each([
    { manual: {} },
    { earn_loyalty_point: { corporations: [{ corporation_id: 98000001 }] } },
    { unknown: { type: 'future-project', data: { target: 42 } } },
  ])('accepts a single declared variant: %j', (value) => {
    expect(configuration.parse(value)).toEqual(value);
  });

  it.each([
    {},
    { manual: {}, earn_loyalty_point: {} },
    { manual: null },
    { earn_loyalty_point: { corporations: [{ corporation_id: 'invalid' }] } },
    { unknown: { data: {} } },
  ])('rejects missing, ambiguous, or malformed variants: %j', (value) => {
    expect(() => configuration.parse(value)).toThrow(/Invalid input/);
  });
});
