import { Smartphone, Tv, Wifi, Zap, type LucideIcon } from 'lucide-react';

import type { BillCategory, BillPaymentConfig } from '@entole/core/bill-payment';

export type BillsSetup = {
  config: BillPaymentConfig;
  itemCodes: Partial<Record<BillCategory, string>>;
};

function parseItemCodes(raw: string | undefined): Partial<Record<BillCategory, string>> {
  try {
    const parsed: unknown = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Partial<Record<BillCategory, string>>) : {};
  } catch {
    return {};
  }
}

/** A proxy-scoped token, never the aggregator's own secret — a browser bundle can't hold that. */
export function billsSetup(): BillsSetup | null {
  const token = process.env.NEXT_PUBLIC_BILL_PAYMENT_PROXY_TOKEN;
  if (!token) return null;
  const apiBase = process.env.NEXT_PUBLIC_BILL_PAYMENT_API_BASE;
  return {
    config: { apiKey: token, ...(apiBase ? { apiBase } : {}) },
    itemCodes: parseItemCodes(process.env.NEXT_PUBLIC_BILL_ITEM_CODES),
  };
}

export const BILL_ICONS: Record<BillCategory, LucideIcon> = {
  electricity: Zap,
  'airtime-data': Smartphone,
  'cable-tv': Tv,
  internet: Wifi,
};
