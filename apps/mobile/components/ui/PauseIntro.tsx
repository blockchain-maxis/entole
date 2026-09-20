import { useRouter } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useAssistant } from '@/lib/assistant';
import { hasSeenPauseIntro, markPauseIntroSeen } from '@/lib/session';
import { useThemeColors } from '@/lib/theme';

import { Button } from './Button';
import { Text } from './Text';

/**
 * Shown once, at the top of Home, and only while the assistant is off. The
 * assistant is a setting, not a default: this says what it is and leads to the
 * screen where it is explained and approved. "Not now" dismisses it for good —
 * the Assistant chip in every header still leads there.
 */
export function PauseIntro() {
  const router = useRouter();
  const colors = useThemeColors();
  const assistant = useAssistant();
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    hasSeenPauseIntro()
      .then((value) => live && setSeen(value))
      .catch(() => live && setSeen(true));
    return () => {
      live = false;
    };
  }, []);

  if (seen !== false || assistant.loading || assistant.enabled) return null;

  function dismiss() {
    setSeen(true);
    void markPauseIntroSeen();
  }

  function getStarted() {
    dismiss();
    router.push('/assistant');
  }

  return (
    <View className="mx-5 mb-5 rounded-card border border-line bg-card p-4">
      <View className="flex-row items-center gap-2.5">
        <ShieldCheck size={18} strokeWidth={1.75} color={colors.slate} />
        <Text className="font-strong text-body text-ink">Your assistant, with limits</Text>
      </View>
      <Text className="mt-2 font-body text-body-sm text-slate">
        Entole&apos;s assistant can pay for you inside the limits you set. It is off until you
        turn it on.
      </Text>
      <View className="mt-3.5 flex-row gap-2.5">
        <Button label="Get started" width="hug" onPress={getStarted} />
        <Button label="Not now" variant="quiet" width="hug" onPress={dismiss} />
      </View>
    </View>
  );
}
