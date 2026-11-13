import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { ASSISTANT_NAME } from '@entole/core/assistant-persona';
import { useAyoNudges } from '@entole/core/ayo-hook';

import { useAssistant } from '@/lib/assistant';
import { assistantHref } from '@/lib/assistant-run';

import { Text } from './Text';

/**
 * The one thing Ayo thinks is worth saying today, on Home: pay that just
 * landed, a subscription about to renew, a week under the usual. Written in
 * the assistant's blue, because it is the assistant talking, with one thing
 * to do and a way to say not now.
 *
 * Every figure in it is the person's own (`ayo-nudges.ts`). Its button only
 * opens a screen with the amount filled in; the person still confirms. Shown
 * only once the assistant is turned on: it is a setting, never a default.
 * Mirrors `apps/web/components/AyoCard.tsx`.
 */
export function AyoCard() {
  const router = useRouter();
  const { talking, enabled } = useAssistant();
  const { top, dismiss } = useAyoNudges();
  if (!(talking || enabled) || !top) return null;
  const sentence = top.ask ? `${top.text} ${top.ask}` : top.text;

  return (
    <View accessibilityLabel={`${ASSISTANT_NAME} says: ${sentence}`} className="mt-5 rounded-control bg-indigo-wash px-4 pb-3 pt-3.5">
      <Text className="font-strong text-note text-indigo">{ASSISTANT_NAME}</Text>
      <Text tabular className="mt-1 font-display-plain text-prose text-indigo">
        {sentence}
      </Text>
      <View className="mt-3 flex-row items-center gap-4">
        {top.action ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(assistantHref(top.action!.step))}
            className="h-11 justify-center rounded-control bg-ink px-4 active:opacity-80"
          >
            <Text tabular className="font-strong text-ui text-paper">
              {top.action.label}
            </Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => void dismiss(top.id)} className="min-h-11 justify-center active:opacity-60">
          <Text className="font-strong text-ui text-slate underline">{top.action ? 'Not now' : 'Got it'}</Text>
        </Pressable>
      </View>
    </View>
  );
}
