import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';

import { formatNaira, kobo } from '@entole/core/money';
import { useStore } from '@entole/core/store';

import { useToast } from '@/lib/toast';

/**
 * Says that money arrived. A payment someone sends lands in the activity list
 * the next time the account is read; this is what tells the person so, with
 * who it was from and how much, wherever in the app they happen to be.
 *
 * It only ever speaks of a payment that has already settled and is already in
 * the list, and it says each one once. It draws nothing itself: the words go
 * to the one banner the app has.
 */
export function ArrivalAnnouncer() {
  const { arrivals, clearArrivals, contact } = useStore();
  const { show } = useToast();

  useEffect(() => {
    const [latest] = arrivals;
    if (!latest) return;
    const who = contact(latest.contactId)?.name;
    show(
      arrivals.length === 1
        ? `${who ?? 'Someone'} sent you ${formatNaira(kobo(latest.amountMinor))}`
        : `${arrivals.length} payments arrived`,
      'settled',
    );
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    clearArrivals();
  }, [arrivals, clearArrivals, contact, show]);

  return null;
}
