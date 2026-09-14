import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { hasOnboarded } from '@/lib/session';

/** Sends a returning person straight to their balance, everyone else to setup. */
export default function Entry() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    hasOnboarded()
      .then((value) => live && setOnboarded(value))
      .catch(() => live && setOnboarded(false));
    return () => {
      live = false;
    };
  }, []);

  if (onboarded === null) return <View className="flex-1 bg-paper" />;
  return <Redirect href={onboarded ? '/(tabs)' : '/onboarding'} />;
}
