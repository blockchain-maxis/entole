'use client';

import { StoreProvider } from '@entole/core/store';

import { AuthGate } from '@/components/AuthGate';
import { AccountProvider, useAccount } from '@/lib/account';
import { useOnChainGateway } from '@/lib/onchain';

/**
 * The store is the same one the phone app runs, over the same gateway
 * interface — only the rendering differs between the two apps. The gateway
 * itself is real: `useOnChainGateway` returns an honest "not signed in yet"
 * pending gateway until `AccountProvider` holds a signed-in owner+session
 * account, then builds the live on-chain gateway exactly as
 * `apps/mobile/lib/onchain.ts` does.
 */
function GatewayBoundary({ children }: { children: React.ReactNode }) {
  const { account } = useAccount();
  const gateway = useOnChainGateway(account);
  return (
    <StoreProvider gateway={gateway}>
      <AuthGate>{children}</AuthGate>
    </StoreProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AccountProvider>
      <GatewayBoundary>{children}</GatewayBoundary>
    </AccountProvider>
  );
}
