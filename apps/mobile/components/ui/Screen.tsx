import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/lib/theme';

type Props = {
  children: React.ReactNode;
  /** Sheets draw their own top edge. */
  edges?: { top?: boolean; bottom?: boolean };
  className?: string;
};

export function Screen({ children, edges, className }: Props) {
  const insets = useSafeAreaInsets();
  const top = edges?.top === false ? 0 : insets.top;
  const bottom = edges?.bottom === false ? 0 : insets.bottom;
  const { resolved } = useTheme();

  return (
    <View className="flex-1 bg-paper" style={{ paddingTop: top, paddingBottom: bottom }}>
      {/* expo-status-bar's "dark"/"light" names the content color, not the
          background — dark content for the light theme, light content for
          the dark theme, inverted from `resolved`. */}
      <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />
      <View className={className ?? 'flex-1'}>{children}</View>
    </View>
  );
}

/**
 * Bottom-anchored actions. Nothing important lives in the top corners except
 * the pause control.
 */
export function ActionBar({
  children,
  divided = true,
}: {
  children: React.ReactNode;
  divided?: boolean;
}) {
  return (
    <View
      className={`flex-none flex-row gap-2.5 px-gutter pb-2.5 pt-3 ${
        divided ? 'border-t border-hairline' : ''
      }`}
    >
      {children}
    </View>
  );
}
