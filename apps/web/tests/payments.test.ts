import { encodeAbiParameters, encodeEventTopics, type Address, type Log } from 'viem';
import { describe, expect, it } from 'vitest';

import { readSettledPayment, settledNaira } from '@/lib/server/payments';

const PAYER = '0x26dfd3aa7601B57d8b7BB9e9555f5Bdac60dAB01' as Address;
const PAID = '0xc0d9BC33696d2F5676A1AcB1e39d03046405eE80' as Address;
const ROUTER = '0x1111111111111111111111111111111111111111' as Address;
const TOKEN = '0x2222222222222222222222222222222222222222' as Address;
const TREASURY = '0x3333333333333333333333333333333333333333' as Address;
const STRANGER = '0x4444444444444444444444444444444444444444' as Address;

const PAID_EVENT = {
  type: 'event',
  name: 'Paid',
  inputs: [
    { name: 'from', type: 'address', indexed: true },
    { name: 'recipient', type: 'address', indexed: true },
    { name: 'amount', type: 'uint256', indexed: false },
    { name: 'fee', type: 'uint256', indexed: false },
    { name: 'salt', type: 'bytes32', indexed: false },
  ],
} as const;
const TRANSFER_EVENT = {
  type: 'event',
  name: 'Transfer',
  inputs: [
    { name: 'from', type: 'address', indexed: true },
    { name: 'to', type: 'address', indexed: true },
    { name: 'value', type: 'uint256', indexed: false },
  ],
} as const;

const log = (address: Address, topics: unknown, data: `0x${string}`): Log =>
  ({
    address,
    topics,
    data,
    blockHash: `0x${'00'.repeat(32)}`,
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: `0x${'ab'.repeat(32)}`,
    transactionIndex: 0,
    removed: false,
  }) as unknown as Log;

function paid(from: Address, recipient: Address, amount: bigint, fee: bigint, at: Address = ROUTER): Log {
  return log(
    at,
    encodeEventTopics({ abi: [PAID_EVENT], eventName: 'Paid', args: { from, recipient } }),
    encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }],
      [amount, fee, `0x${'07'.repeat(32)}`],
    ),
  );
}

function transfer(from: Address, to: Address, value: bigint, at: Address = TOKEN): Log {
  return log(
    at,
    encodeEventTopics({ abi: [TRANSFER_EVENT], eventName: 'Transfer', args: { from, to } }),
    encodeAbiParameters([{ type: 'uint256' }], [value]),
  );
}

const where = { payer: PAYER, router: ROUTER, token: TOKEN };

describe('reading a settled payment from its own record', () => {
  it('an ordinary send: who was paid and what they got, not what left the payer', () => {
    const logs = [
      transfer(PAYER, ROUTER, 3_170_000n),
      transfer(ROUTER, PAID, 3_160_000n),
      transfer(ROUTER, TREASURY, 10_000n),
      paid(PAYER, PAID, 3_160_000n, 10_000n),
    ];
    expect(readSettledPayment(logs, where)).toEqual({ recipient: PAID, amountToken: 3_160_000n });
  });

  it('a payment inside an allowance, or a plain transfer: the money moving says it', () => {
    expect(readSettledPayment([transfer(PAYER, PAID, 1_500_000n)], where)).toEqual({
      recipient: PAID,
      amountToken: 1_500_000n,
    });
  });

  it('is nothing when the person reporting it did not pay', () => {
    const someoneElses = [transfer(STRANGER, ROUTER, 3_170_000n), paid(STRANGER, PAID, 3_160_000n, 10_000n)];
    expect(readSettledPayment(someoneElses, where)).toBeNull();
    expect(readSettledPayment([transfer(STRANGER, PAID, 5n)], where)).toBeNull();
    expect(readSettledPayment([], where)).toBeNull();
  });

  it('does not believe a look-alike: the line must come from the real router and the real asset', () => {
    expect(readSettledPayment([paid(PAYER, PAID, 9_000_000n, 0n, STRANGER)], where)).toBeNull();
    expect(readSettledPayment([transfer(PAYER, PAID, 9_000_000n, STRANGER)], where)).toBeNull();
  });

  it('money handed to the router with no line saying who it was for is not a payment to anyone', () => {
    expect(readSettledPayment([transfer(PAYER, ROUTER, 3_170_000n)], where)).toBeNull();
  });

  it('paying yourself is not money arriving', () => {
    expect(readSettledPayment([transfer(PAYER, PAYER, 5n)], where)).toBeNull();
  });
});

describe('the naira figure kept for a payment', () => {
  const rate = { koboPerDollar: 158_000, quotedAt: '2026-10-12T16:00:00.000Z' };
  // 5,000 naira at 1,580 is 3.16 dollars to the cent; 3.16 back is 4,992.80.
  const moved = { amountToken: 3_160_000n, tokenDecimals: 6 };

  it('keeps what the sender typed when it is what produced the amount that moved', () => {
    expect(settledNaira({ ...moved, rate, stated: { amountMinor: 500_000, koboPerDollar: 158_000 } })).toBe(500_000);
  });

  it('works it out when the sender said nothing', () => {
    expect(settledNaira({ ...moved, rate })).toBe(499_280);
  });

  it('does not let a sender make a payment read as more than it was', () => {
    // Claiming a hundred times the amount at the true rate.
    expect(settledNaira({ ...moved, rate, stated: { amountMinor: 50_000_000, koboPerDollar: 158_000 } })).toBe(499_280);
    // Claiming a rate nobody was offering, to make the same dollars read as more naira.
    expect(settledNaira({ ...moved, rate, stated: { amountMinor: 50_000_000, koboPerDollar: 15_822_785 } })).toBe(499_280);
  });

  it('allows the rate to have moved a little between the two ends', () => {
    expect(settledNaira({ ...moved, rate, stated: { amountMinor: 505_600, koboPerDollar: 160_000 } })).toBe(505_600);
  });

  it('stands behind no figure at all when it has no rate of its own', () => {
    expect(settledNaira({ ...moved, rate: null, stated: { amountMinor: 500_000, koboPerDollar: 158_000 } })).toBeUndefined();
  });
});
