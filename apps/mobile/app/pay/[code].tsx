import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { useBackend } from '@entole/core/backend';
import { formatHandle } from '@entole/core/handle';
import { readRecipient } from '@entole/core/recipient';

import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { RowSkeleton, Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useAccount } from '@/lib/account';
import { payLinkFromRoute, resolveSendTarget } from '@/lib/recipient';
import { hasOnboarded, hasStoredCredential } from '@/lib/session';

type Outcome = 'opening' | 'nobody' | 'unreadable';

/**
 * Where a pay link lands when it is opened in the app: "Open in the Entole
 * app" on the pay page, or `entole://pay/@ada.eze` from anywhere else. It
 * shows nothing of its own for long. It asks the directory who the link is
 * for and hands over to Send, with them chosen and the amount the link asked
 * for filled in. The same door as pasting the link or scanning it.
 *
 * Opened cold, the account is not in memory yet, so the person confirms it is
 * them first and is brought back here. Someone with no account on this phone
 * goes to the first screen.
 */
export default function OpenPayLink() {
  const router = useRouter();
  const backend = useBackend();
  const { account } = useAccount();
  const params = useLocalSearchParams();
  const link = useMemo(() => payLinkFromRoute(params), [params]);
  const [outcome, setOutcome] = useState<Outcome>(link ? 'opening' : 'unreadable');

  // Not signed in here yet: unlock, then come back to this link.
  useEffect(() => {
    if (account) return;
    let live = true;
    Promise.all([hasOnboarded(), hasStoredCredential()])
      .then(([finished, hasPasskey]) => {
        if (!live) return;
        if (finished && hasPasskey) router.replace({ pathname: '/lock', params: link ? { next: link } : {} });
        else router.replace('/onboarding');
      })
      .catch(() => live && router.replace('/onboarding'));
    return () => {
      live = false;
    };
  }, [account, link, router]);

  useEffect(() => {
    if (!account || !link) return;
    let live = true;
    void resolveSendTarget(link, undefined, backend).then((target) => {
      if (!live) return;
      if (!target) return setOutcome('unreadable');
      if (target === 'unclaimed') return setOutcome('nobody');
      router.replace({ pathname: '/send', params: target });
    });
    return () => {
      live = false;
    };
  }, [account, link, backend, router]);

  const sought = link ? readRecipient(link) : null;
  const written = sought?.kind === 'handle' ? formatHandle(sought.handle) : null;
  const home: Href = '/(tabs)';

  if (outcome === 'opening') {
    return (
      <Screen>
        <Header title="Send" trailing={account ? undefined : null} />
        <View accessibilityLabel="Finding who this is for" className="px-gutter pt-2">
          <RowSkeleton />
          <Skeleton className="mt-9 h-3 w-16 rounded-md" />
          <Skeleton className="mt-3 h-12 w-48 rounded-md" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title="Send" trailing={account ? undefined : null} />
      <View className="flex-1 justify-center px-gutter-lg pb-16">
        <Text accessibilityRole="header" className="font-display text-subhead text-ink">
          {outcome === 'nobody' && written ? `Nobody on Entole has ${written} yet` : 'That link doesn’t lead to anyone'}
        </Text>
        <Text className="mt-2 font-body text-ui text-slate">
          {outcome === 'nobody'
            ? 'Check the link with whoever sent it. Nothing was sent.'
            : 'It isn’t an Entole pay link, or part of it is missing. Nothing was sent.'}
        </Text>
      </View>
      <ActionBar>
        <Button label="Home" variant="secondary" onPress={() => router.replace(home)} />
        <Button label="Send to someone" onPress={() => router.replace('/send/pick')} />
      </ActionBar>
    </Screen>
  );
}
