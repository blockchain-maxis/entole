import { describe, expect, it } from 'vitest';

import { askedMinor } from '@/lib/asked-amount';

describe('an amount put in the address', () => {
  it('is kobo, as whole digits', () => {
    expect(askedMinor('500000')).toBe(500_000);
  });

  it.each([null, '', '0', '-5', '12.5', '1e5', 'abc', '99999999999999'])('%s is no amount', (value) => {
    expect(askedMinor(value)).toBeUndefined();
  });
});
