import { useRouter } from 'expo-router';
import { Pause, Play } from 'lucide-react-native';
import { Pressable } from 'react-native';

import { useStore } from '@entole/core/store';

import { useThemeColors } from '@/lib/theme';

/**
 * The exit. Every screen header carries this — never buried, never a second
 * tap away. Pressing it opens the confirmation screen; it never toggles
 * silently from the header itself. Icon-only by design — a text label here
 * reads as a loud header element on every single screen; the icon + tint
 * carries the same one-tap affordance without the visual weight.
 */
export function PauseButton() {
  const router = useRouter();
  const { paused } = useStore();
  const colors = useThemeColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={paused ? 'Resume everything Entole does for you' : 'Pause everything Entole does for you'}
      hitSlop={14}
      onPress={() => router.push('/pause')}
      className={`h-9 w-9 items-center justify-center rounded-pill border ${
        paused ? 'border-halt bg-halt-wash' : 'border-line bg-card'
      }`}
    >
      {paused ? (
        <Play size={16} strokeWidth={1.5} color={colors.halt.DEFAULT} />
      ) : (
        <Pause size={16} strokeWidth={1.5} color={colors.slate} />
      )}
    </Pressable>
  );
}
