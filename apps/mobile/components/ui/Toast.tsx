import { CheckCircle2 } from 'lucide-react-native';
import { Pressable } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AssistantBadge } from './Badge';
import { Text } from './Text';
import { useThemeColors } from '@/lib/theme';
import { useToast, useToastEntry } from '@/lib/toast';

/**
 * The confirmation for something that just settled — a send, or the
 * assistant's own payment. Sits above everything else, dismisses itself, and
 * never claims a state the payment hasn't reached: it only ever appears after
 * `store.send`/`store.runProposal` has already resolved.
 */
export function ToastHost() {
  const entry = useToastEntry();
  const { dismiss } = useToast();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();

  if (!entry) return null;

  const assistant = entry.tone === 'assistant';

  return (
    <Animated.View
      key={entry.id}
      entering={FadeInUp.duration(220)}
      exiting={FadeOutUp.duration(160)}
      pointerEvents="box-none"
      style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, zIndex: 50 }}
    >
      <Pressable
        accessibilityRole="alert"
        onPress={dismiss}
        className={`flex-row items-center gap-2.5 rounded-control border px-4 py-3 shadow-floating ${
          assistant ? 'border-indigo-line bg-indigo-wash' : 'border-line bg-card'
        }`}
      >
        <CheckCircle2 size={18} strokeWidth={1.8} color={assistant ? colors.indigo.DEFAULT : colors.settled.DEFAULT} />
        <Text className="flex-1 font-strong text-label-sm text-ink">{entry.message}</Text>
        {assistant ? <AssistantBadge /> : null}
      </Pressable>
    </Animated.View>
  );
}
