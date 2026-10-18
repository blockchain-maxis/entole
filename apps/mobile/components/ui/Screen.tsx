import { StatusBar } from 'expo-status-bar';
import { KeyboardAvoidingView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useResolvedScheme } from '@/lib/theme';

/** The least room left under a screen's last element. Many Android phones
 * report no inset at the bottom at all, and a button then sat ten pixels from
 * the edge of the glass. */
const BOTTOM_FLOOR = 16;

type Props = {
  children: React.ReactNode;
  /** Sheets draw their own top edge. */
  edges?: { top?: boolean; bottom?: boolean };
  /** For a screen someone types on: when the keyboard comes up the screen
   * ends above it, so a bottom-anchored button rides up with it instead of
   * waiting underneath. */
  keyboard?: boolean;
  className?: string;
};

export function Screen({ children, edges, keyboard = false, className }: Props) {
  const insets = useSafeAreaInsets();
  const top = edges?.top === false ? 0 : insets.top;
  const bottom = edges?.bottom === false ? 0 : Math.max(insets.bottom, BOTTOM_FLOOR);
  const resolved = useResolvedScheme();

  return (
    <View className="flex-1 bg-paper" style={{ paddingTop: top, paddingBottom: bottom }}>
      {/* expo-status-bar's "dark"/"light" names the content color, not the
          background — dark content for the light theme, light content for
          the dark theme, inverted from `resolved`. */}
      <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />
      {keyboard ? (
        <KeyboardAvoidingView behavior="padding" className={className ?? 'flex-1'}>
          {children}
        </KeyboardAvoidingView>
      ) : (
        <View className={className ?? 'flex-1'}>{children}</View>
      )}
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
  centered = false,
}: {
  children: React.ReactNode;
  divided?: boolean;
  /** For a single action that hugs its label: it sits in the middle of the bar instead of at one end. */
  centered?: boolean;
}) {
  return (
    <View
      className={`flex-none flex-row gap-2.5 px-gutter pb-2.5 pt-3 ${centered ? 'justify-center' : ''} ${
        divided ? 'border-t border-hairline' : ''
      }`}
    >
      {children}
    </View>
  );
}
