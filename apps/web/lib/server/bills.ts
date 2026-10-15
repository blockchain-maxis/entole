import { erc20Abi, parseEther, type Address, type Hex } from 'viem';

import type { BillCategory, BillPaymentConfig } from '@entole/core/bill-payment';
import { createRateProvider } from '@entole/core/fx';

import { getRedis } from './redis';
import { getSponsor, sendSerially, signerFor, TOKEN_ADDRESS } from './sponsor';

/**
 * Bill payment's server-side setup. Everything secret lives here and in the
 * two routes under `app/api/bills`: the biller's key is never prefixed
 * NEXT_PUBLIC_ and never reaches a browser or the phone bundle. Server-only,
 * same rule as `sponsor.ts`.
 */

export type BillsServerConfig = {
  biller: BillPaymentConfig;
  /** The account bill payments are made to (public, like any address). */
  recipient: Address;
  itemCodes: Partial<Record<BillCategory, string>>;
};

function parseItemCodes(raw: string | undefined): Partial<Record<BillCategory, string>> {
  try {
    const parsed: unknown = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Partial<Record<BillCategory, string>>)
      : {};
  } catch {
    return {};
  }
}

/** The bills setup, or `null` when the biller key or the receiving account is
 * missing, so the routes answer 501. Read per call, never at build time. */
export function getBillsConfig(): BillsServerConfig | null {
  const apiKey = process.env.BILL_PAYMENT_API_KEY?.trim();
  const recipient = process.env.NEXT_PUBLIC_ENTOLE_BILLS_ADDRESS?.trim();
  if (!apiKey || !recipient || !/^0x[0-9a-fA-F]{40}$/.test(recipient)) return null;

  const apiBase = process.env.BILL_PAYMENT_API_BASE?.trim();
  const validatePath = process.env.BILL_VALIDATE_PATH?.trim();
  const payPath = process.env.BILL_PAY_PATH?.trim();
  return {
    biller: {
      apiKey,
      ...(apiBase ? { apiBase } : {}),
      ...(validatePath ? { validatePath } : {}),
      ...(payPath ? { payPath } : {}),
    },
    recipient: recipient as Address,
    itemCodes: parseItemCodes(process.env.BILL_ITEM_CODES),
  };
}

/** The live naira rate, read on the server so the amount a person signed can be
 * checked against the bill without trusting the device's own number. */
export const getServerRate = createRateProvider();

/** Below this the bills account cannot pay a refund's fee, and the sponsor tops it up. */
const BILLS_MIN_GAS = parseEther('0.02');
const BILLS_TOP_UP = parseEther('0.05');
/** How long a refunded payment is remembered, so it is never refunded twice. */
const REFUND_MEMORY_SECONDS = 60 * 60 * 24 * 90;

const refundedHere = new Set<string>();

/**
 * The bills account's own key (`BILLS_PRIVATE_KEY`), only when it is the
 * account bills are paid into. Server-only; never logged or returned.
 */
export function getBillsSigner(recipient: Address) {
  const key = process.env.BILLS_PRIVATE_KEY?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  const signer = signerFor(key as Hex);
  return signer.account.address.toLowerCase() === recipient.toLowerCase() ? signer : null;
}

export type RefundOutcome = { refunded: true; refundHash: Hex } | { refunded: false; reason: 'no_key' | 'already' | 'failed' };

/**
 * Sends a payment the biller refused back to whoever paid it, from the bills
 * account, once. The payment's hash is remembered first (in Redis where there
 * is one), so the same refusal asked about twice is refunded once. What the
 * person paid into the bills account goes back; the router's fee does not,
 * because it was never the bills account's to return.
 */
export async function refundBill(input: { hash: Hex; payer: Address; amount: bigint; recipient: Address }): Promise<RefundOutcome> {
  const signer = getBillsSigner(input.recipient);
  if (!signer) return { refunded: false, reason: 'no_key' };

  const lock = `bills:refund:${input.hash.toLowerCase()}`;
  const redis = getRedis();
  if (redis) {
    const first = await redis.set(lock, '1', { nx: true, ex: REFUND_MEMORY_SECONDS });
    if (first !== 'OK') return { refunded: false, reason: 'already' };
  } else {
    if (refundedHere.has(lock)) return { refunded: false, reason: 'already' };
    refundedHere.add(lock);
  }

  try {
    const balance = await signer.publicClient.getBalance({ address: signer.account.address });
    if (balance < BILLS_MIN_GAS) {
      const sponsor = getSponsor();
      if (sponsor) {
        const topUp = await sendSerially(() =>
          sponsor.walletClient.sendTransaction({ to: signer.account.address, value: BILLS_TOP_UP }),
        );
        await sponsor.publicClient.waitForTransactionReceipt({ hash: topUp });
      }
    }
    const refundHash = await signer.walletClient.writeContract({
      address: TOKEN_ADDRESS,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [input.payer, input.amount],
    });
    const settled = await signer.publicClient.waitForTransactionReceipt({ hash: refundHash });
    return settled.status === 'success' ? { refunded: true, refundHash } : { refunded: false, reason: 'failed' };
  } catch {
    return { refunded: false, reason: 'failed' };
  }
}

/** For tests: forgets refunds remembered in memory. */
export function resetRefunds(): void {
  refundedHere.clear();
}
