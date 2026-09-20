import { describe, expect, it } from 'vitest';

import { COUNTRIES, countryName, searchCountries } from './countries';

describe('countries', () => {
  it('is the full ISO 3166-1 list, 249 unique alpha-2 codes', () => {
    expect(COUNTRIES).toHaveLength(249);
    expect(new Set(COUNTRIES.map((country) => country.code)).size).toBe(249);
    for (const country of COUNTRIES) expect(country.code).toMatch(/^[A-Z]{2}$/);
  });

  it('names a code, and refuses what is not one', () => {
    expect(countryName('NG')).toBe('Nigeria');
    expect(countryName('ng')).toBe('Nigeria');
    expect(countryName('Lagos')).toBeUndefined();
    expect(countryName(undefined)).toBeUndefined();
  });

  it('searches by the start of any word, or by code', () => {
    expect(searchCountries('nigeria').map((country) => country.code)).toEqual(['NG']);
    expect(searchCountries('kingdom').map((country) => country.code)).toContain('GB');
    expect(searchCountries('gb').map((country) => country.code)).toEqual(['GB']);
    expect(searchCountries('   ')).toHaveLength(249);
  });
});
