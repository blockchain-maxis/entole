'use client';

import { StoreProvider } from '@entole/core/store';

import { AuthGate } from '@/components/AuthGate';
import { AccountProvider, useAccount } from '@/lib/account';
import { AssistantProvider, useAssistant } from '@/lib/assistant';
import { useOnChainGateway } from '@/lib/onchain';
import { ThemeProvider } from '@/lib/theme';

/**
 * The store is the same one the phone app runs, over the same gateway
 * interface — only the rendering differs between the two apps. The gateway
 * itself is real: `useOnChainGateway` returns an honest "not signed in yet"
 * pending gateway until `AccountProvider` holds a signed-in owner
 * account, then builds the live on-chain gateway exactly as
 * `apps/mobile/lib/onchain.ts` does.
 */
function GatewayBoundary({ children }: { children: React.ReactNode }) {
  const { account } = useAccount();
  const assistant = useAssistant();
  const gateway = useOnChainGateway(account, assistant);
  return (
    <StoreProvider gateway={gateway}>
      <AuthGate>{children}</AuthGate>
    </StoreProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AccountProvider>
        <AssistantProvider>
          <GatewayBoundary>{children}</GatewayBoundary>
        </AssistantProvider>
      </AccountProvider>
    </ThemeProvider>
  );
}
