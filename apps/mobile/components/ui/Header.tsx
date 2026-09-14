import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Text } from './Text';

type Props = {
  title?: string;
  /** `back` on pushed screens, `close` on anything presented as a sheet. */
  leading?: 'back' | 'close' | 'brand' | 'none';
  /** Replaces the pause control — used on the pause screen itself. */
  trailing?: React.ReactNode;
  onLeadingPress?: () => void;
  children?: React.ReactNode;
};

export function Header({ title, leading = 'back', trailing, onLeadingPress, children }: Props) {
  const router = useRouter();
  const goBack = onLeadingPress ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));

  return (
    <View className="flex-none flex-row items-center justify-between px-gutter pb-3.5 pt-2">
      <View className="flex-1 flex-row items-center gap-3.5">
        {leading === 'brand' ? (
          <>
            <View className="h-[30px] w-[30px] items-center justify-center rounded-pip bg-ink">
              <Text className="font-heavy text-body text-paper">E</Text>
            </View>
            <Text className="font-heavy text-headline text-ink">Entole</Text>
          </>
        ) : null}

        {leading === 'back' || leading === 'close' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={leading === 'back' ? 'Go back' : 'Close'}
            hitSlop={14}
            onPress={goBack}
          >
            <Text className="font-body text-title text-slate">{leading === 'back' ? '←' : '✕'}</Text>
          </Pressable>
        ) : null}

        {title ? <Text className="font-strong text-body-lg text-ink">{title}</Text> : null}
        {children}
      </View>

      {trailing ?? null}
    </View>
  );
}
