'use client';

import { usePathname } from 'next/navigation';

import { BackendProvider } from '@entole/core/backend';
import { StoreProvider } from '@entole/core/store';

import { AuthGate } from '@/components/AuthGate';
import { AccountProvider, useAccount } from '@/lib/account';
import { AssistantProvider, useAssistant } from '@/lib/assistant';
import { useOnChainBackend } from '@/lib/onchain';
import { isPublicPath } from '@/lib/public-routes';
import { ThemeProvider } from '@/lib/theme';

/**
 * Public routes (`/pay/…`, the checkout page) are for people with no account:
 * they skip the account gate and the tab bar, and render as themselves.
 * Everything else is gated exactly as before.
 */
function Gate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isPublicPath(pathname)) return <>{children}</>;
  return <AuthGate>{children}</AuthGate>;
}

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
  const { gateway, backend } = useOnChainBackend(account, assistant);
  return (
    <BackendProvider value={backend}>
      <StoreProvider gateway={gateway}>
        <Gate>{children}</Gate>
      </StoreProvider>
    </BackendProvider>
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
