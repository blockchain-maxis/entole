import { describe, expect, it } from 'vitest';

import { buildClaimMessage } from './directory';

const ADDRESS = '0x1111111111111111111111111111111111111111' as const;

describe('buildClaimMessage', () => {
  it('is the same string for the same inputs, so client and server always agree', () => {
    const a = buildClaimMessage({ address: ADDRESS, name: 'Ada', timestampSeconds: 100 });
    const b = buildClaimMessage({ address: ADDRESS, name: 'Ada', timestampSeconds: 100 });
    expect(a).toBe(b);
  });

  it('changes when the name, phone or timestamp changes', () => {
    const base = buildClaimMessage({ address: ADDRESS, name: 'Ada', timestampSeconds: 100 });
    expect(buildClaimMessage({ address: ADDRESS, name: 'Grace', timestampSeconds: 100 })).not.toBe(base);
    expect(
      buildClaimMessage({ address: ADDRESS, name: 'Ada', timestampSeconds: 100, phone: { country: 'ng', number: '8012345678' } }),
    ).not.toBe(base);
    expect(buildClaimMessage({ address: ADDRESS, name: 'Ada', timestampSeconds: 101 })).not.toBe(base);
  });

  it('is case-insensitive on the address, so a checksummed and lowercase address sign the same message', () => {
    const lower = buildClaimMessage({ address: ADDRESS, name: 'Ada', timestampSeconds: 100 });
    const upper = buildClaimMessage({
      address: '0x1111111111111111111111111111111111111111'.toUpperCase() as typeof ADDRESS,
      name: 'Ada',
      timestampSeconds: 100,
    });
    expect(lower).toBe(upper);
  });
});
