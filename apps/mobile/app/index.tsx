import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { hasOnboarded, hasStoredCredential } from '@/lib/session';

/** Sends a returning person straight to their balance, everyone else to setup.
 * "Returning" needs a saved passkey as well as the onboarded flag: the lock
 * screen can only unlock a passkey that exists, so a phone with the flag and
 * no passkey would otherwise be stuck there for good. */
export default function Entry() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([hasOnboarded(), hasStoredCredential()])
      .then(([finished, hasPasskey]) => live && setOnboarded(finished && hasPasskey))
      .catch(() => live && setOnboarded(false));
    return () => {
      live = false;
    };
  }, []);

  if (onboarded === null) return <View className="flex-1 bg-paper" />;
  return <Redirect href={onboarded ? '/(tabs)' : '/onboarding'} />;
}
