import type { Address } from 'viem';

import type { BillCategory, BillPaymentConfig } from '@entole/core/bill-payment';
import { createRateProvider } from '@entole/core/fx';

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
