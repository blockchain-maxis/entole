import { ONRAMP_CHAIN_ID } from '@entole/core/onramp';
import { getAddress, isAddress, type Address } from 'viem';
import { z } from 'zod';

/**
 * What the add-money routes share. Real money comes in on the main network
 * only: none of the partners reach the test network, so there every one of
 * these routes is off and the app offers test money instead.
 */

export const accountAddress = z
  .string()
  .refine((value) => isAddress(value, { strict: false }))
  .transform((value): Address => getAddress(value));

export type MoneyInConfig = {
  /** The account's own money, which everything is converted into. */
  settlementToken: Address;
  /** Optional. The conversion partner answers without one, at a lower rate limit. */
  apiKey?: string;
};

/** Read per call, so nothing is captured at build time. `null` means off. */
export function readMoneyInConfig(): MoneyInConfig | null {
  if (Number(process.env.NEXT_PUBLIC_CHAIN_ID) !== ONRAMP_CHAIN_ID) return null;
  const settlementToken = accountAddress.safeParse(process.env.NEXT_PUBLIC_ENTOLE_TOKEN_ADDRESS?.trim());
  if (!settlementToken.success) return null;
  const apiKey = process.env.RELAY_API_KEY?.trim();
  return { settlementToken: settlementToken.data, ...(apiKey ? { apiKey } : {}) };
}
