import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useBackend } from '@entole/core/backend';
import type { Staff } from '@entole/core/records';

export type StaffState = {
  status: 'loading' | 'ready' | 'failed';
  staff: Staff[];
};

/**
 * The people the business pays, read from this device's records each time the
 * screen comes into focus — so a person added on the next screen is already
 * there when you come back. Alphabetical; nothing is invented while it loads.
 */
export function useStaff(): StaffState & { reload: () => Promise<void> } {
  const { source } = useBackend();
  const [state, setState] = useState<StaffState>({ status: 'loading', staff: [] });

  const reload = useCallback(async () => {
    try {
      const staff = await source.listStaff();
      setState({ status: 'ready', staff: [...staff].sort((a, b) => a.name.localeCompare(b.name, 'en')) });
    } catch {
      setState((current) => ({ ...current, status: 'failed' }));
    }
  }, [source]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { ...state, reload };
}

/** "₦150,000 · monthly", or what to expect when no regular pay is set. */
export function cadenceWord(cadence: Staff['cadence']): string | null {
  return cadence === 'weekly' ? 'weekly' : cadence === 'monthly' ? 'monthly' : null;
}
