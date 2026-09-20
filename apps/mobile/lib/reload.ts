import { useCallback, useState } from 'react';

import { useStore } from '@entole/core/store';

/**
 * Re-reads the account. A failed re-read is not an error to surface again —
 * the screen already says what failed — so it just settles and leaves the last
 * real numbers where they are.
 */
export function useReload() {
  const { refresh } = useStore();
  const [reloading, setReloading] = useState(false);

  const reload = useCallback(async () => {
    setReloading(true);
    try {
      await refresh();
    } catch {
      // Nothing new to show.
    } finally {
      setReloading(false);
    }
  }, [refresh]);

  return { reload, reloading };
}
