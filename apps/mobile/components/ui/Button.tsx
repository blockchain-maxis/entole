import { Pressable, View, type PressableProps } from 'react-native';

import { useThemeColors } from '@/lib/theme';

import { LogoLoader } from './LogoLoader';
import { Text } from './Text';

type Variant = 'primary' | 'raised' | 'secondary' | 'destructive' | 'quiet' | 'danger-outline';

const CONTAINER: Record<Variant, string> = {
  primary: 'bg-ink active:opacity-80',
  /** Same fill as `primary`, plus elevation — the one CTA per screen that
   * should read as the thing to press, e.g. a hero card's action. */
  raised: 'bg-ink active:opacity-80 shadow-raised',
  secondary: 'bg-card border border-line active:border-mist',
  destructive: 'bg-halt active:bg-halt-deep',
  quiet: 'bg-transparent',
  'danger-outline': 'bg-card border border-line active:border-halt active:bg-halt-tint',
};

const LABEL: Record<Variant, string> = {
  primary: 'text-paper',
  raised: 'text-paper',
  secondary: 'text-ink',
  destructive: 'text-card',
  quiet: 'text-slate',
  'danger-outline': 'text-halt',
};

type Props = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  variant?: Variant;
  busy?: boolean;
  /** `full` fills its row; `hug` keeps its own width for a paired action. */
  width?: 'full' | 'hug';
};

export function Button({
  label,
  variant = 'primary',
  busy = false,
  width = 'full',
  disabled,
  ...rest
}: Props) {
  const inactive = disabled === true || busy;
  const colors = useThemeColors();
  // The mark, in the colour the label would have been.
  const markColor = {
    primary: colors.paper,
    raised: colors.paper,
    secondary: colors.ink,
    destructive: colors.card,
    quiet: colors.slate,
    'danger-outline': colors.halt.DEFAULT,
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      className={`${width === 'full' ? 'flex-1' : 'flex-none px-5'} items-center justify-center rounded-control py-4 ${
        CONTAINER[variant]
      } ${inactive ? 'opacity-50' : ''}`}
      {...rest}
    >
      {busy ? (
        <View className="h-[21px] justify-center">
          <LogoLoader size={21} color={markColor} label={`${label}, in progress`} />
        </View>
      ) : (
        <Text className={`font-strong text-ui ${LABEL[variant]}`}>{label}</Text>
      )}
    </Pressable>
  );
}
