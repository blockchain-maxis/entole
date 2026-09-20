import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Gauge, Hand, ShieldCheck, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { AssistantTag } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useAssistant } from '@/lib/assistant';
import { useThemeColors } from '@/lib/theme';

const POINTS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Gauge,
    title: 'It only spends what you allow',
    body: 'Each thing it can do is an allowance: an amount, how often it resets, and a balance that only goes down as it is used. When the balance is gone, it stops.',
  },
  {
    icon: Hand,
    title: 'You can stop it in one tap',
    body: 'The Assistant chip at the top of every screen pauses it right away. Your allowances stay exactly as they are.',
  },
  {
    icon: ShieldCheck,
    title: 'You still send money yourself',
    body: 'Turning it on changes nothing about how you pay people. Leave it off and Entole never moves money on its own.',
  },
];

/**
 * Where the assistant is explained and approved. It is a setting the person
 * turns on, never a default — so this is the only place its second passkey
 * confirmation happens, and signing in never asks for it.
 */
export default function AssistantSettings() {
  const router = useRouter();
  const assistant = useAssistant();
  const colors = useThemeColors();
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function turnOn() {
    setWorking(true);
    setProblem(null);
    try {
      const result = await assistant.enable();
      if (result.ok) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setProblem(result.reason);
      }
    } finally {
      setWorking(false);
    }
  }

  async function turnOff() {
    setWorking(true);
    setProblem(null);
    try {
      await assistant.disable();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } finally {
      setWorking(false);
    }
  }

  return (
    <Screen>
      <Header title="Assistant" />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <AssistantTag>{assistant.enabled ? 'On' : 'Off'}</AssistantTag>

        <Text className="mt-4 font-strong text-headline text-ink">
          {assistant.enabled ? 'The assistant is on' : 'Let Entole pay for you, within limits'}
        </Text>
        <Text className="mt-2.5 font-body text-body-sm text-slate">
          {assistant.enabled
            ? 'It can propose and make payments for you, only inside the allowances you set. Turn it off any time and it stops proposing anything.'
            : 'The assistant can propose and make payments for you, like a bill that comes round every month. It is off until you turn it on here.'}
        </Text>

        <View className="mt-7 gap-5">
          {POINTS.map((point) => (
            <View key={point.title} className="flex-row gap-3.5">
              <View className="h-10 w-10 items-center justify-center rounded-control bg-indigo-wash">
                <point.icon size={20} strokeWidth={1.75} color={colors.indigo.DEFAULT} />
              </View>
              <View className="flex-1">
                <Text className="font-strong text-body text-ink">{point.title}</Text>
                <Text className="mt-1 font-body text-body-sm text-slate">{point.body}</Text>
              </View>
            </View>
          ))}
        </View>

        {assistant.enabled ? null : (
          <Text className="mt-7 font-body text-label-sm text-mist">
            Turning it on asks you to confirm with your passkey once more.
          </Text>
        )}
        {problem ? <Text className="mt-4 font-body text-label-sm text-halt">{problem}</Text> : null}
      </ScrollView>

      <ActionBar>
        {assistant.enabled ? (
          <Button
            label={working ? 'Working' : 'Turn off the assistant'}
            variant="secondary"
            busy={working}
            onPress={() => void turnOff()}
          />
        ) : (
          <Button
            label={working ? 'Confirming' : 'Turn on the assistant'}
            busy={working}
            disabled={assistant.loading}
            onPress={() => void turnOn()}
          />
        )}
      </ActionBar>
      {assistant.enabled ? (
        <View className="px-gutter pb-2.5">
          <Button label="Done" variant="quiet" onPress={() => router.replace('/(tabs)')} />
        </View>
      ) : null}
    </Screen>
  );
}
