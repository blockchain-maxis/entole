import { useRouter } from 'expo-router';
import { Mic } from 'lucide-react-native';
import { Pressable } from 'react-native';

import { useAssistant } from '@/lib/assistant';
import { useThemeColors } from '@/lib/theme';

/**
 * The way to talk to the assistant, in every header beside the assistant's own
 * control: that corner is where the assistant lives. It is there only while
 * the person talks to it, which needs no key. Off means off, and nothing about
 * the app changes.
 *
 * It is a second control and never takes the other one's place, so the way to
 * stop the assistant is still one tap.
 */
export function TalkButton() {
  const router = useRouter();
  const { talking } = useAssistant();
  const colors = useThemeColors();

  if (!talking) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Talk to the assistant"
      hitSlop={10}
      onPress={() => router.push('/talk')}
      className="h-9 w-9 flex-none items-center justify-center rounded-pill bg-indigo-wash active:scale-95"
    >
      <Mic size={17} strokeWidth={1.9} color={colors.indigo.DEFAULT} />
    </Pressable>
  );
}
