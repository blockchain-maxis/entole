import Constants from 'expo-constants';
import { Smartphone, Tv, Wifi, Zap, type LucideIcon } from 'lucide-react-native';

import type { BillCategory, BillPaymentConfig } from '@entole/core/bill-payment';

type ExtraConfig = {
  billPaymentApiBase?: string;
  billPaymentProxyToken?: string;
  billItemCodes?: Partial<Record<BillCategory, string>>;
};

const extra = (Constants.expoConfig?.extra?.entole ?? {}) as ExtraConfig;

export type BillsSetup = {
  config: BillPaymentConfig;
  itemCodes: Partial<Record<BillCategory, string>>;
};

/** A proxy-scoped token, never the aggregator's own secret — a phone bundle can't hold that. */
export function billsSetup(): BillsSetup | null {
  if (!extra.billPaymentProxyToken) return null;
  return {
    config: {
      apiKey: extra.billPaymentProxyToken,
      ...(extra.billPaymentApiBase ? { apiBase: extra.billPaymentApiBase } : {}),
    },
    itemCodes: extra.billItemCodes ?? {},
  };
}

export const BILL_ICONS: Record<BillCategory, LucideIcon> = {
  electricity: Zap,
  'airtime-data': Smartphone,
  'cable-tv': Tv,
  internet: Wifi,
};
