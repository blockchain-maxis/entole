'use client';

import { StoreProvider } from '@entole/core/store';

/**
 * The store is the same one the phone app runs, over the same demo gateway.
 * Only the rendering differs between the two apps.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <StoreProvider>{children}</StoreProvider>;
}
