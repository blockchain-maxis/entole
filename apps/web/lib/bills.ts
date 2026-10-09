import { Smartphone, Tv, Wifi, Zap, type LucideIcon } from 'lucide-react';

import type { BillCategory } from '@entole/core/bill-payment';

/**
 * Bill payment is on when the account bills are paid into is configured. The
 * biller's own secret lives only on the server (`apps/web/app/api/bills/*`);
 * nothing here, and nothing in a browser bundle, can pay a bill without a
 * payment signed by the person.
 */
export function billsAvailable(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_ENTOLE_BILLS_ADDRESS);
}

export const BILL_ICONS: Record<BillCategory, LucideIcon> = {
  electricity: Zap,
  'airtime-data': Smartphone,
  'cable-tv': Tv,
  internet: Wifi,
};
