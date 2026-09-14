import { ActivityIndicator, Pressable, View, type PressableProps } from 'react-native';

import { Text } from './Text';

type Variant = 'primary' | 'secondary' | 'destructive' | 'quiet' | 'danger-outline';

const CONTAINER: Record<Variant, string> = {
  primary: 'bg-indigo active:bg-indigo-deep',
  secondary: 'bg-card border border-line active:border-mist',
  destructive: 'bg-halt active:bg-halt-deep',
  quiet: 'bg-transparent',
  'danger-outline': 'bg-card border border-line active:border-halt active:bg-halt-tint',
};

const LABEL: Record<Variant, string> = {
  primary: 'text-card',
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
          <ActivityIndicator size="small" />
        </View>
      ) : (
        <Text className={`font-strong text-body ${LABEL[variant]}`}>{label}</Text>
      )}
    </Pressable>
  );
}
