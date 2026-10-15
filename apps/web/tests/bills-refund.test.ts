import { privateKeyToAccount } from 'viem/accounts';
import { afterEach, describe, expect, it } from 'vitest';

import { getBillsSigner, refundBill } from '@/lib/server/bills';

const KEY = `0x${'42'.repeat(32)}` as const;
const BILLS = privateKeyToAccount(KEY).address;
const OTHER = '0x3333333333333333333333333333333333333333';
const HASH = `0x${'cd'.repeat(32)}` as const;

afterEach(() => {
  delete process.env.BILLS_PRIVATE_KEY;
});

describe('who can send a bill payment back', () => {
  it('only the bills account itself, by its own key', () => {
    process.env.BILLS_PRIVATE_KEY = KEY;
    expect(getBillsSigner(BILLS)?.account.address).toBe(BILLS);
    // A key for some other account is not used, whatever it is.
    expect(getBillsSigner(OTHER)).toBeNull();
  });

  it('with no key there is nothing to send it back with, and it is said', async () => {
    expect(await refundBill({ hash: HASH, payer: OTHER, amount: 1n, recipient: BILLS })).toEqual({
      refunded: false,
      reason: 'no_key',
    });
  });
});
