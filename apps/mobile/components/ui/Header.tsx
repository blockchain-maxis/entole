import { useRouter } from 'expo-router';
import { ArrowLeft, X } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { useThemeColors } from '@/lib/theme';

import { BrandMark } from './BrandMark';
import { PauseButton } from './PauseButton';
import { Text } from './Text';

type Props = {
  title?: string;
  /** `back` on pushed screens, `close` on anything presented as a sheet. */
  leading?: 'back' | 'close' | 'brand' | 'none';
  /** Replaces the pause control. Left undefined, every header carries it —
   * that default is what makes "pause is reachable from every screen
   * header" structurally true instead of something each screen has to
   * remember. Pass `null` to show nothing (only the pause screen itself
   * should). */
  trailing?: React.ReactNode | null;
  onLeadingPress?: () => void;
  children?: React.ReactNode;
};

export function Header({ title, leading = 'back', trailing, onLeadingPress, children }: Props) {
  const router = useRouter();
  const colors = useThemeColors();
  const goBack = onLeadingPress ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));

  return (
    <View className="flex-none flex-row items-center justify-between px-gutter pb-3.5 pt-2">
      <View className="flex-1 flex-row items-center gap-3.5">
        {leading === 'brand' ? <BrandMark /> : null}

        {leading === 'back' || leading === 'close' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={leading === 'back' ? 'Go back' : 'Close'}
            hitSlop={14}
            onPress={goBack}
          >
            {leading === 'back' ? (
              <ArrowLeft size={24} color={colors.slate} strokeWidth={1.5} />
            ) : (
              <X size={24} color={colors.slate} strokeWidth={1.5} />
            )}
          </Pressable>
        ) : null}

        {title ? <Text className="font-strong text-body-lg text-ink">{title}</Text> : null}
        {children}
      </View>

      {trailing === undefined ? <PauseButton /> : trailing}
    </View>
  );
}
