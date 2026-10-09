import Constants from 'expo-constants';
import { Smartphone, Tv, Wifi, Zap, type LucideIcon } from 'lucide-react-native';

import type { BillCategory } from '@entole/core/bill-payment';

type ExtraConfig = {
  billsAddress?: string;
};

const extra = (Constants.expoConfig?.extra?.entole ?? {}) as ExtraConfig;

/**
 * Bill payment is on when the account bills are paid into is configured. The
 * biller's own secret lives only on the server (`apps/web/app/api/bills/*`);
 * a phone bundle holds nothing that can pay a bill without a payment the
 * person signed.
 */
export function billsAvailable(): boolean {
  return Boolean(extra.billsAddress);
}

export const BILL_ICONS: Record<BillCategory, LucideIcon> = {
  electricity: Zap,
  'airtime-data': Smartphone,
  'cable-tv': Tv,
  internet: Wifi,
};
