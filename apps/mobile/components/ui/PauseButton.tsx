import { useRouter } from 'expo-router';
import { ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react-native';
import { Pressable } from 'react-native';

import { useStore } from '@entole/core/store';

import { useAssistant } from '@/lib/assistant';
import { useThemeColors } from '@/lib/theme';

import { Text } from './Text';

/**
 * The exit. Every screen header carries this — never buried, never a second
 * tap away. Pressing it opens a screen; it never toggles silently from the
 * header itself.
 *
 * It says what it controls, and what state that is in. The assistant is a
 * setting the person turns on, so a new person sees "Assistant · Off" and
 * tapping it explains and offers to turn it on; once on it reads "Assistant ·
 * On" and tapping it pauses; paused it turns the halt tint.
 */
export function PauseButton() {
  const router = useRouter();
  const { paused } = useStore();
  const { enabled } = useAssistant();
  const colors = useThemeColors();

  const state = !enabled ? 'off' : paused ? 'paused' : 'on';
  const label = { off: 'Assistant · Off', on: 'Assistant · On', paused: 'Assistant · Paused' }[state];
  const hint = {
    off: 'The assistant is off. Open to learn what it does and turn it on.',
    on: 'The assistant is on. Open to pause it.',
    paused: 'The assistant is paused. Open to resume it.',
  }[state];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint}
      hitSlop={12}
      onPress={() => router.push(state === 'off' ? '/assistant' : '/pause')}
      className={`h-9 flex-none flex-row items-center gap-1.5 rounded-pill border px-3 ${
        state === 'paused' ? 'border-halt bg-halt-wash' : 'border-line bg-card'
      }`}
    >
      {state === 'paused' ? (
        <ShieldAlert size={15} strokeWidth={1.75} color={colors.halt.DEFAULT} />
      ) : state === 'off' ? (
        <ShieldOff size={15} strokeWidth={1.75} color={colors.mist} />
      ) : (
        <ShieldCheck size={15} strokeWidth={1.75} color={colors.slate} />
      )}
      <Text
        className={`font-strong text-label-sm ${
          state === 'paused' ? 'text-halt' : state === 'off' ? 'text-mist' : 'text-slate'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
