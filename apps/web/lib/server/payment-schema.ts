import { getAddress, isAddress, type Address, type Hex } from 'viem';
import { z } from 'zod';

/**
 * The signed payment a person's device sends to the sponsor: one ERC-3009
 * authorization for `EntoleRouter.pay`. Shared by every route that relays one
 * (`/api/relay`, `/api/bills/pay`) so they validate it identically.
 */

export const UINT256_MAX = 2n ** 256n - 1n;

export const addressField = z
  .string()
  .refine((value) => isAddress(value, { strict: false }))
  .transform((value): Address => getAddress(value));

export const minorUnitsField = z
  .string()
  .regex(/^\d{1,78}$/)
  .transform((value) => BigInt(value))
  .refine((value) => value <= UINT256_MAX);

export const wordField = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((value) => value as Hex);

export const paymentSchema = z.object({
  from: addressField,
  recipient: addressField,
  amount: minorUnitsField,
  validAfter: minorUnitsField,
  validBefore: minorUnitsField,
  salt: wordField,
  v: z.union([z.literal(27), z.literal(28)]),
  r: wordField,
  s: wordField,
});

export type SignedPayment = z.infer<typeof paymentSchema>;

export const routerAbi = [
  {
    type: 'function',
    name: 'pay',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'salt', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

/** Plain reason code for a failed simulate or send, by the revert text only. */
export function paymentRevertCode(error: unknown): string {
  const text = (
    error instanceof Error
      ? ((error as { shortMessage?: string }).shortMessage ?? error.message)
      : String(error)
  ).toLowerCase();
  // 0xe450d38c is ERC20InsufficientBalance, which viem cannot name without the token's ABI.
  if (text.includes('balance') || text.includes('0xe450d38c')) return 'insufficient_funds';
  if (text.includes('expired') || text.includes('not yet valid')) return 'expired';
  if (/\bused\b/.test(text)) return 'already_used';
  if (text.includes('bad signature') || text.includes('invalid')) return 'invalid_signature';
  return 'rejected';
}
