import { describe, expect, it } from 'vitest';

import { buildClaimMessage, lookupUsername } from './directory';

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

describe('a username in a claim', () => {
  it('is part of what is signed, so nobody can add one to a claim they did not sign', () => {
    const without = buildClaimMessage({ address: ADDRESS, name: 'Ada', timestampSeconds: 100 });
    const withName = buildClaimMessage({ address: ADDRESS, name: 'Ada', username: 'ada.eze', timestampSeconds: 100 });
    expect(withName).not.toBe(without);
    expect(withName).toContain('username: ada.eze');
    expect(buildClaimMessage({ address: ADDRESS, name: 'Ada', username: 'ada.king', timestampSeconds: 100 })).not.toBe(withName);
  });

  it('leaves a claim without one exactly as it was signed before usernames existed here', () => {
    expect(buildClaimMessage({ address: ADDRESS, name: 'Ada', timestampSeconds: 100 })).toBe(
      ['Entole identity claim', `address: ${ADDRESS}`, 'name: Ada', 'phone: none', 'timestamp: 100'].join('\n'),
    );
  });
});

describe('asking whether a username is someone\'s', () => {
  const answer = (status: number, body?: unknown) =>
    (async () => new Response(body ? JSON.stringify(body) : null, { status })) as unknown as typeof fetch;

  it('is free when the directory has nobody by that name', async () => {
    await expect(lookupUsername('', 'ada.eze', answer(404))).resolves.toEqual({ state: 'free' });
  });

  it('is taken, and says by whom, when it has', async () => {
    const identity = { address: ADDRESS, name: 'Ada Eze', initials: 'AE', tone: 1, username: 'ada.eze' };
    await expect(lookupUsername('https://entole.pro/', 'ada.eze', answer(200, identity))).resolves.toEqual({
      state: 'taken',
      identity,
    });
  });

  it('promises nothing when the directory cannot be asked', async () => {
    await expect(lookupUsername('', 'ada.eze', answer(501))).resolves.toEqual({ state: 'unknown' });
    const offline = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(lookupUsername('', 'ada.eze', offline)).resolves.toEqual({ state: 'unknown' });
  });

  it('does not ask at all for something that is not a username', async () => {
    let asked = 0;
    const counting = (async () => ((asked += 1), new Response(null, { status: 404 }))) as unknown as typeof fetch;
    await expect(lookupUsername('', 'No Spaces', counting)).resolves.toEqual({ state: 'unknown' });
    expect(asked).toBe(0);
  });
});
